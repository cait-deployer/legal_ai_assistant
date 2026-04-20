# URAI — Технічна архітектура чатбота

> Документ для онбордингу AI-агентів та розробників.  
> Описує **реальний стан системи** станом на квітень 2026.  
> Без вигадок — тільки те, що є в коді `backend/server.py`.

---

## 1. Загальна схема роботи чатбота

```
Питання користувача (UA або RU)
        │
        ▼
[0] RU→UA переклад (якщо "ы/ъ/э" і немає "і/ї/є/ґ")
        │
        ▼
[1] Query Rewrite — Gemini few-shot переформульовує в юридичний стиль
     └─ ThinkingConfig(budget=0), temperature=0, few-shot приклади з Supabase `rewrite_examples`
        │
        ├──────────────────────────────────────┐
        ▼                                      ▼
[2a] embed(оригінал)               [2b] embed(rewrite) — якщо rewrite успішний
        │                                      │
        └──────────────────┬───────────────────┘
                           ▼
[3] Routing: план підписки → filter_sources → plan_collections
     └─ Intent classifier (Gemini, top-2 галузі) → _INTENT_MAP → target_collections
        │
        ▼
[4] Multi-query vector search по Qdrant target_collections
     - fetch_k = max_docs × 5 кандидатів з кожної колекції
     - Паралельно: search(embed_original) + search(embed_rewrite)
     - Merge: дедуп по (law_id, chunk_index), max score
     - match_threshold = max(0.33, settings.match_threshold_docs)
        │
        ▼
[5] LOW CONFIDENCE check: top raw score < 0.42 → low_confidence=True
     └─ НЕ зупиняємось, НЕ обрізаємо — BM25 і title boost компенсують слабкий вектор
        │
        ▼
[6] Source score adjustment:
     - rada_* та laws_positions → ×1.15 (буст, налаштовується в адмінці)
     - laws_supreme             → ×0.88 (penalty: широкі PDF матчаться на все)
     - laws_kmu, laws_ccu       → без змін
        │
        ▼
[7] Dedup: max 2 чанки від одного law_id
        │
        ▼
[8] Diversity cap:
     - laws_positions → max(1, max_docs//4) слотів
     - laws_supreme   → max(2, max_docs//4) слотів
     - Інші колекції  → гарантовано max(2, (max_docs×¾) // N) слотів кожна
     - Overflow: конкуренція по similarity
        │
        ▼
[9] Keyword search (BM25 MatchText на поле content):
     - Топ-4 слова з питання, morphological (pymorphy3 UA)
     - Stem слова шукаються в source+doc_type+content[:1500] — відхиляємо нерелевантні
     - Score динамічний: 0.25 + 0.30×(matched/total) → діапазон 0.25–0.55
     - Нові документи додаються до пулу
        │
        ▼
[10] Title boost (MatchText на поле source):
     - Keywords = слова >4 симв з питання (до 3) + rewrite (до 7) + pymorphy3 леми
     - Стоп-слова фільтруються (цікавить, хочу, треба, розмір...)
     - chunks_per_doc=1, cap=20 документів
     - Пріоритет: laws_kmu(0) > laws_supreme(1) > laws_ccu(2) > laws_wiki(3) > rada_*
     - Якщо документ знайдено і title boost і semantic → +0.10 до similarity
     - Score динамічний: 0.50 + 0.35×(matched_kws/total_kws) → діапазон 0.50–0.85
     - Нові документи додаються до пулу
        │
        ▼
[11] LLM Reranker (Gemini, якщо кандидатів > max_docs):
     - Бере до 60 кандидатів (по 350 символів кожен)
     - Вибирає рівно min(max_docs, max(8, max_docs//2)) найкорисніших
       (при max_docs=12 → 8; при max_docs=20 → 10)
     - ThinkingConfig(budget=0), temperature=0
     - Fallback: семантичний top-N якщо reranker повернув < 2 індексів
        │
        ▼
[12] Hard-stop: top score < min_score (0.55) → "не знайдено"
     └─ Пропускається якщо low_confidence=True (Gemini вже отримав guardrail)
        │
        ▼
[13] Фільтр "Втратив чинність" — виключаємо скасовані документи
        │
        ▼
[14] Контекст для Gemini (3 bucket-и, кожен обмежений):
     ├─ Закони Ради + wiki: max 4 чанки
     ├─ Постанови КМУ: max 3 чанки
     └─ Судова практика (positions + supreme + ccu): max 2 чанки
     Context cap: 14 000 символів
        │
        ▼
[15] Gemini — генерує відповідь
     - System prompt з Supabase app_settings
     - Response instructions: деталізація / кроки / сценарії (з плану)
     - Citation rule: обов'язково [N] на кожне твердження
     - Guardrail якщо top_score < 0.68 → "перелічи всі знайдені документи, поясни що є в чанку і чого бракує (таблиці, суми), дай посилання"
     - Guardrail якщо low_confidence → "слабко впевнено + ⚠️ рекомендую уточнити"
     - Clarifying question: обов'язково якщо `low_confidence` або `top_score < 0.75`; інакше — необов'язково (тільки якщо є природне продовження)
     - Ліміт слів: 350 (base) або 800 (response_detailed/scenarios)
        │
        ▼
[16] JSON відповідь: { answer, references, templates, _meta }
     _meta: { processing_time_ms, tokens_used, category,
              low_confidence, top_score, n_docs,
              sentiment, complexity_score, user_intent }
     + паралельно: класифікатор (sentiment, complexity, user_intent) для аналітики
```

---

## 2. Qdrant — структура бази

### 2.1 Всі колекції (18 штук)

| Колекція | Джерело | Що зберігається | Chunk (старий → новий) |
|----------|---------|-----------------|------------------------|
| `rada_finance` | zakon.rada.gov.ua | Фінанси, банки, ПДВ, митниця (h2, h3, h26, h23) | 1500 → **3000** |
| `rada_state` | zakon.rada.gov.ua | Держустрій, громадянство (h4) — 25K+ документів | 1500 → **3000** |
| `rada_personnel` | zakon.rada.gov.ua | Кадрові питання, нагородження (h27) | 1500 → **3000** |
| `rada_court` | zakon.rada.gov.ua | Суд, прокуратура, господарський процес (h22, h30, h1) | 1500 → **3000** |
| `rada_intl` | zakon.rada.gov.ua | Міжнародні відносини, договори (h11) | 1500 → **3000** |
| `rada_labor` | zakon.rada.gov.ua | Трудові відносини, соціальне страхування (h19, h20) | 1500 → **3000** |
| `rada_civil` | zakon.rada.gov.ua | Цивільне, сімейне, охорона здоров'я (h5, h16, h13) | 1500 → **3000** |
| `rada_criminal` | zakon.rada.gov.ua | Кримінальне та процесуальне (h25) | 1500 → **3000** |
| `rada_admin` | zakon.rada.gov.ua | Адм. відповідальність, ліцензування (h8, h10, h31) | 1500 → **3000** |
| `rada_housing` | zakon.rada.gov.ua | Житлове, ЖКГ, будівництво (h6, h21) | 1500 → **3000** |
| `rada_land` | zakon.rada.gov.ua | Земельне, сільське господарство (h9, h18) | 1500 → **3000** |
| `rada_industry` | zakon.rada.gov.ua | Транспорт, промисловість, підприємства (h7, h17, h15) | 1500 → **3000** |
| `rada_other` | zakon.rada.gov.ua | Освіта, наука, культура, ЗСУ (h12, h14, h24, h28, h29, h32) | 1500 → **3000** |
| `laws_kmu` | zakon.rada.gov.ua/laws/main/o2 | НПА Кабінету Міністрів (постанови, розпорядження) | 1500 → **4000** |
| `laws_supreme` | supreme.court.gov.ua | Квартальні PDF-огляди практики Верховного Суду | ~1500 |
| `laws_wiki` | legalaid.wiki | Вікі-статті правової допомоги | ~1500 |
| `laws_ccu` | ccu.gov.ua | Рішення та Висновки Конституційного Суду | ~1500 |
| `laws_positions` | lpd.court.gov.ua | Правові позиції Верховного Суду (~12 800) | ~2000 |

**Вектор:** 768 вимірів, cosine distance, модель `text-embedding-004` (Google Vertex AI)

**Title-prefix:** у кожному чанку починається з назви закону — `"{law_title}\n\n{chunk}"`.  
Це вже є в нових індексованих чанках (після reindex) та `laws_positions`.

**Повнотекстові індекси (BM25):** поля `content` і `source` проіндексовані для keyword search.

---

### 2.2 Payload (поля) кожного документа в Qdrant

```json
{
  "content":        "Текст чанку (title-prefix + уривок) — відправляється в Gemini",
  "source":         "Заголовок документа (для title boost і відображення)",
  "law_id":         "Унікальний ID (наприклад: kmu_663-99-%D0%BF, або zakoni-vidbory)",
  "doc_type":       "Постанова КМУ / Правова позиція / Рішення КСУ / ...",
  "category":       "Галузь права / тип документа",
  "law_url":        "Пряме посилання на документ",
  "source_domain":  "zakon.rada.gov.ua / lpd.court.gov.ua / ...",
  "status":         "Чинний / Втратив чинність / ...",
  "doc_number":     "Номер документа",
  "date_adopted":   "Дата прийняття",
  "scraped_at":     "ISO datetime індексування",
  "chunk_index":    0,
  "reindexed":      true,

  // Текстові маркери (з detect_text_flags для rada_*):
  "wartime_only":   false,   // діє тільки в умовах воєнного стану
  "is_suspended":   false,   // дію призупинено
  "is_retroactive": false,   // має зворотню дію

  // Тільки для laws_kmu:
  "effective_date": "Дата набуття чинності",

  // Тільки для laws_positions:
  "lpd_id":         123456,
  "title":          "Назва правової позиції",
  "court_tag":      "Велика Палата / КАС / КЦС / ККС / КГС",
  "court_abbr":     "ВП ВС",
  "categories":     "категорія1, категорія2",
  "case_numbers":   "справа1, справа2",

  // Тільки для laws_ccu:
  "doc_subtype":    "Рішення / Висновок",

  // Тільки для laws_supreme:
  "pdf_url":        "посилання на PDF",

  // Тільки для laws_wiki:
  "wiki_title":     "Назва статті legalaid.wiki"
}
```

---

### 2.3 Як документи потрапляють в базу

| Колекція | Скрапер | Логіка |
|----------|---------|--------|
| `rada_*` | `rada_scanner.py` | Ітерує сторінки по тематичних розділах (h2..h32), конвертує HTML→Markdown, title-prefix, chunk 3000 |
| `laws_kmu` | `kmu_scanner.py` | zakon.rada.gov.ua/laws/main/o2 (видавник КМУ), `law_id = "kmu_" + rada_id`, title-prefix, chunk 4000 |
| `laws_supreme` | `supreme_scanner.py` | PDF з supreme.court.gov.ua, PyPDFLoader, chunk ~1500 |
| `laws_wiki` | `wiki_scanner.py` | MediaWiki API legalaid.wiki, chunk ~1500 |
| `laws_ccu` | `ccu_scanner.py` | HTTP + PDF, ccu.gov.ua, chunk ~1500 |
| `laws_positions` | `lpd_scanner.py` | JSON API lpd.court.gov.ua, title вставляється на початку, chunk ~2000 |

**Incremental sync:** перевіряє `get_existing_law_ids()` і пропускає вже проіндексовані (по `law_id`).  
**Full reindex:** `reindex_kmu_full.py` / `reindex_rada_full.py` — видаляють старі чанки і завантажують нові з оновленими налаштуваннями. Запускаються з адмінки або вручну.  
**IDs cache:** після збору списку законів (15–30 хв) зберігається JSON-файл (`reindex_*_ids_cache.json`, TTL 48 год). При краші сервера під час обробки — наступний запуск завантажує з кешу і пропускає фазу збору. Видаляється після успішного завершення.

---

## 3. Pipeline `/ask` — детально

### 3.1 Вхідний запит

```python
POST /ask
{
  "question": "Як розрахувати добові за кордон?",
  "max_docs": 12,                               # з плану підписки (8–20)
  "filter_sources": ["rada", "kmu", "supreme"], # null = всі дозволені планом
  "response_features": ["response_detailed", "response_steps"],
  "user_profile": {"role": "юрист", "sub_role": ["трудове"]},
  "history": [{"role": "user", "content": "..."}],
  "ai_personal_prompt": "Відповідай коротко."
}
```

### 3.2 Крок 0 — Переклад RU→UA

Детект: є `ы/ъ/э` І немає `і/ї/є/ґ` → переклад через Gemini (temperature=0, max_tokens=300).  
Перекладений текст використовується замість оригіналу для embedding і пошуку.

### 3.3 Крок 1 — Query Rewrite

Gemini переформульовує запит у формальний юридичний стиль:
- Few-shot приклади завантажуються з `app_settings.rewrite_examples` (Supabase) — редагуються з адмінки без деплою
- `ThinkingConfig(thinking_budget=0)` — вимкнено thinking (швидше, без усічення виводу)
- `temperature=0.0`, `max_output_tokens=2500`
- Перевірка: rewrite відхиляється якщо < 4 слів або > 300 символів або збігається з оригіналом

### 3.4 Крок 2 — Embed

Паралельно:
- `embed(search_question)` — оригінал (або перекладений)
- `embed(rewrite)` — якщо rewrite успішний (не None)

Модель: `text-embedding-004` (Vertex AI), 768 dims.

### 3.5 Крок 3 — Routing

**Шар 1 — план підписки:**  
`filter_sources` → `plan_collections` (наприклад, `["rada", "kmu"]` → відповідні колекції)

**Шар 2 — intent classifier (top-2):**  
Gemini (temperature=0, max_tokens=50) класифікує до **2 галузей** → об'єднує колекції з `_INTENT_MAP`.  
Якщо питання міждисциплінарне ("звільнення військового за злочин" → `трудове, кримінальне`) — колекції обох галузей мерджаться.

| Intent | Колекції |
|--------|----------|
| трудове | rada_labor, laws_kmu, laws_positions, laws_supreme |
| податкове / фінансове | rada_finance, laws_kmu, laws_positions, laws_supreme |
| цивільне | rada_civil, laws_kmu, laws_positions, laws_supreme |
| кримінальне | rada_criminal, laws_kmu, laws_positions, laws_supreme, laws_ccu |
| адміністративне | rada_admin, rada_state, laws_kmu, laws_positions, laws_supreme |
| земельне | rada_land, laws_kmu, laws_positions |
| житлове | rada_housing, laws_kmu, laws_positions |
| корпоративне | rada_civil, rada_finance, laws_positions, laws_supreme |
| міжнародне | rada_intl, laws_positions, laws_supreme |
| кадрове | rada_personnel, rada_labor, laws_kmu, laws_positions |
| судове | laws_positions, laws_supreme, laws_ccu, rada_court |
| інше | **всі** план-дозволені колекції |

Fallback при помилці classifier: `["rada_labor", "rada_civil", "laws_kmu", "rada_finance", "laws_positions"]`  
(не all collections — щоб не засмічувати результати нерелевантними колекціями)

**Парсинг:** Gemini повертає до 2 слів через кому → `re.split(r"[,\s]+")[:2]` → кожен лейбл резолвиться в `_INTENT_MAP` → колекції мерджаться (порядок: першої галузі → унікальні другої).

### 3.6 Крок 4 — Multi-query vector search

- `fetch_k = max_docs × 5` кандидатів з кожної колекції
- Паралельно: `search(embed_original, fetch_k)` + `search(embed_rewrite, fetch_k)`
- **Merge:** дедуп по `(law_id, chunk_index)`, зберігаємо max score
- `match_threshold = max(0.33, settings.match_threshold_docs)`

### 3.7 Крок 5 — LOW CONFIDENCE (soft fallback)

```python
_RAW_GATE = 0.42
low_confidence = bool(results and results[0]["similarity"] < _RAW_GATE)
# НЕ обрізаємо results — BM25 і title boost ще не запускались і можуть компенсувати
```

**Раніше** — жорстка зупинка ("не знайдено"). **Тепер** — тільки флаг + ширший routing:
- `target_collections` розширюється extra-набором: `[rada_labor, rada_civil, laws_kmu, rada_finance, laws_positions, rada_admin, rada_state]` (тільки дозволені планом)
- Pipeline продовжується повністю (boost → BM25 → title boost → reranker) — вже по ширшому набору
- Hard-stop (min_score 0.55) **пропускається** для low_confidence
- Gemini отримує окремий guardrail: *"слабка впевненість — покажи що є + ⚠️ рекомендую уточнити"*
- `_meta.low_confidence: true` у відповіді

**Чому так:** юридичні embeddings нестабільні — один і той самий закон може давати raw score 0.38–0.45 залежно від формулювання. BM25 і title boost додають документи незалежно від вектора і часто рятують ситуацію. Ширший routing при low_confidence дає їм більше шансів знайти потрібне.

### 3.8 Крок 6–8 — Score adjustment та Diversity

**Source score adjustment (виконується одночасно):**

| Колекція | Коефіцієнт | Причина |
|----------|-----------|---------|
| `rada_*`, `laws_positions` | ×1.15 (з адмінки) | Первинне законодавство пріоритетніше |
| `laws_supreme` | ×0.88 (фіксовано) | PDF-огляди широко матчаться — знижуємо вагу |
| `laws_kmu`, `laws_ccu`, `laws_wiki` | ×1.0 | Без змін |

**Dedup:** максимум 2 чанки від одного `law_id` глобально.

**Diversity cap:**
- `laws_positions` → max(1, max_docs // 4) слотів
- `laws_supreme` → max(2, max_docs // 4) слотів
- Інші колекції → гарантовано max(2, (max_docs×¾) // N) слотів кожна + overflow конкуренція

### 3.9 Крок 9 — Keyword search (BM25)

`search_qdrant_text()` — MatchText по полю `content`:
- Слова > 4 символів з оригінального питання
- Morphological via **pymorphy3** (UA): `відрядженні → відрядження`
- Результат додається тільки якщо stem є в `source + doc_type + content[:1500]`
- Score фіксований = 0.45; **нові** документи додаються до пулу (не замінюють вектор)

### 3.10 Крок 10 — Title Boost

`search_qdrant_by_title()` — MatchText по полю `source`:
- Keywords: слова >4 симв з питання (до 3) + з rewrite (до 7) + pymorphy3 леми
- Стоп-слова виключаються: `цікавить, хочу, треба, потрібно, питання, розмір, ...`
- До 14 ключових слів всього
- `chunks_per_doc=1` (по одному чанку з кожного знайденого закону)
- Cap: 20 документів
- Пріоритет сортування: `laws_kmu(0) > laws_supreme(1) > laws_ccu(2) > laws_wiki(3) > rada_*(9)`
- Якщо документ знайдено **і** title boost **і** vector search → score += 0.10 (підтверджений обома)
- Score фіксований = 0.75; **нові** документи додаються до пулу

### 3.11 Крок 11 — LLM Reranker з protected layer

**Protected slots (виконується ДО reranker):**
- `laws_kmu` і `laws_positions` документи з `_title_match=True` → max 2 protected slots
- Вони не потрапляють до reranker — гарантовано виживають
- Причина: реранкер оптимізує "лінгвістичну очевидність", а КМУ постанови/позиції ВС — сухий табличний текст, який програє огля-дам ВС без цього захисту

**Reranker (відкриті кандидати):**
- Бере до 60 відкритих кандидатів (по 350 символів кожен)
- Gemini (ThinkingConfig budget=0, temperature=0): вибрати рівно `_rr_slots` найкорисніших
  ```python
  _rr_select = min(max_docs, max(8, max_docs // 2))
  _rr_slots = max(1, _rr_select - len(_rr_protected))
  ```
- Prompt включає: "Постанови КМУ та правові позиції ВС — первинні юридичні джерела, надавай їм перевагу"
- Якщо reranker повернув < 2 індексів → fallback до семантичного top-N
- **Фінал:** `_rr_protected + reranked_open`, cap = `max_docs`

### 3.12 Крок 12 — Hard-stop

```python
# Пропускається якщо low_confidence=True
if not low_confidence and (not results or results[0]["similarity"] < min_score):
    return {"answer": "Не знайдено достатньо інформації..."}
# min_score = 0.55 default (app_settings.min_relevance_score)
```

В low_confidence режимі hard-stop не спрацьовує — Gemini вже отримав інструкцію як поводитись зі слабкими результатами.

### 3.13 Крок 13–14 — Контекст для Gemini

Виключаються документи зі статусом `"Втратив чинність / Втратила чинність"`.

Розподіл по bucket-ах:
```
law_chunks   (rada_* + laws_wiki)                      → max 4 чанки
kmu_chunks   (laws_kmu)                                → max 3 чанки
court_chunks (laws_positions, laws_supreme, laws_ccu)  → max 2 чанки
```
Context cap: **14 000 символів** (обрізається якщо більше).

Заголовок кожного чанку в контексті:
```
[N] Назва документа | Тип | № ID | Статус: ... | Дата: ...
⚠️ ДІЄ ЛИШЕ В УМОВАХ ВОЄННОГО СТАНУ  ← якщо wartime_only
---
текст чанку...
```

### 3.14 Крок 15 — Gemini Response

**Модель:** з `app_settings.ai_model` (за замовчуванням `gemini-2.0-flash-001`)  
**System prompt:** з `app_settings.system_prompt`

**Prompt структура:**
```
[Профіль: роль, спеціалізація, сфери]
[Персональний AI-контекст]
[Попередній діалог: останні 12 повідомлень / 6 turns]
Контекст з українського законодавства, структурований за правовою ієрархією:

[закони Ради та wiki]

--- Постанови та розпорядження КМУ ---
[постанови КМУ]

--- Судова практика та правові позиції ---
[positions + supreme + ccu]

---
Питання: ...

[Інструкції відповіді: деталізація / кроки / сценарії]
[Citation rule: кожне твердження обов'язково [N]]
[Guardrail якщо top_score < 0.68: "покажи що є + скажи що не знайдено"]
[Guardrail якщо low_confidence: "слабка впевненість + ⚠️ рекомендую уточнити"]
[Clarifying question якщо неоднозначно]
[Ліміт слів: 350 або 800]
```

**Паралельно** запускається класифікатор (sentiment/complexity/user_intent) — тільки для аналітики.

### 3.15 Структура JSON відповіді

```json
{
  "answer": "Текст відповіді з посиланнями [1], [2]...",
  "references": [
    {
      "num": 1,
      "source_title": "Назва закону",
      "passage": "Уривок тексту до 600 символів",
      "status": "Чинний",
      "law_url": "https://zakon.rada.gov.ua/...",
      "chunk_index": 0
    }
  ],
  "templates": [],
  "_meta": {
    "processing_time_ms": 3200,
    "tokens_used": 1850,
    "category": "Трудове право",
    "low_confidence": false,
    "top_score": 0.847,
    "n_docs": 8,
    "sentiment": "neutral",
    "complexity_score": 2,
    "user_intent": "консультація"
  }
}
```

`low_confidence`, `top_score`, `n_docs` — для дебагу і можливого UX-бейджика на фронтенді.

---

## 4. Налаштування системи (Supabase `app_settings`)

| Ключ | Default | Опис |
|------|---------|------|
| `ai_model` | `gemini-2.0-flash-001` | Модель Gemini для відповіді |
| `rewrite_model` | `gemini-2.5-flash` | Модель для Query Rewrite |
| `intent_model` | `gemini-2.5-flash` | Модель для Intent classifier |
| `embedding_model` | `text-embedding-004` | Vertex AI embedding |
| `temperature` | `0.1` | Температура генерації відповіді |
| `top_p` | `0.8` | Top-p sampling |
| `max_output_tokens` | `8000` | Ліміт токенів відповіді |
| `match_threshold_docs` | `0.35` | Мін. threshold vector search (реальний: max(0.33, value)) |
| `min_relevance_score` | `0.55` | Hard-stop після reranker (не діє при low_confidence) |
| `rada_source_boost` | `1.15` | Буст для rada_* та laws_positions |
| `system_prompt` | fallback | Системний промпт Gemini |
| `llm_timeout_seconds` | `90.0` | Timeout для Gemini |
| `rewrite_examples` | `""` | Few-shot приклади для Query Rewrite: `"розмовна фраза → юридичний термін"` (по одному на рядок) |
| `schedule_enabled` | `false` | Авто-синхронізація РАДА о 01:00 UTC |

---

## 5. Плани підписки → параметри пошуку

`max_docs_retrieved` з `subscription_plans` (8–20 чанків).  
`filter_sources` та `response_features` з `plan_features`:

| Feature key | Що вмикає |
|-------------|-----------|
| `source_rada` | Пошук по `rada_*` колекціях |
| `source_kmu` | Пошук по `laws_kmu` |
| `source_supreme` | Пошук по `laws_supreme` |
| `source_ccu` | Пошук по `laws_ccu` |
| `source_legalaid` | Пошук по `laws_wiki` |
| `source_lpd` | Пошук по `laws_positions` |
| `response_detailed` | Розгорнута відповідь, ліміт 800 слів |
| `response_steps` | Блок "Що робити далі" |
| `response_scenarios` | Альтернативні сценарії |
| `response_vs_position` | Акцент на позиції Верховного Суду |

---

## 6. Відомі обмеження

### 6.1 Морфологічна прірва (частково вирішена)
Embedding не завжди перекидає місток між розмовною та юридичною формою.  
**Mitigation:** Query Rewrite (Gemini few-shot) + pymorphy3 для BM25/title boost.  
**Залишається:** MatchText не має stemming для всіх форм — pymorphy3 lemmatize покриває більшість.

### 6.2 Квартальні огляди ВС (laws_supreme) — широкий матч (частково вирішено)
PDF-огляди покривають багато тем і отримують score 0.70+ на майже будь-який правовий запит.  
**Mitigation:** score ×0.88 (soft penalty) + slot cap max(2, max_docs//4) — разом дають подвійне обмеження.  
**Залишається:** вони все одно потрапляють в результати, просто з нижчою вагою.

### 6.3 Реіндекс в процесі (квітень 2026)
Стара база: chunk_size=1500, без title-prefix embedding.  
Нова база (після reindex): chunk_size=3000/4000, title-prefix.  
**KMU і РАДА переіндексовуються** через адмінку (Синхронізація → Переіндекс). До завершення — частина чанків зі старим embedding, частина з новим.

### 6.4 Intent classifier — до двох галузей
Gemini повертає 1–2 галузі. Міждисциплінарні питання (трудове + кримінальне) тепер покриваються обома колекціями. Ризик залишається для питань, що зачіпають 3+ галузей — classifier обирає найрелевантніші дві. Fallback при помилці: безпечний набір 5 основних колекцій.

### 6.5 laws_supreme — PDF без структури
Чанки з quarterly PDF-оглядів не мають прив'язки до конкретних справ або норм. Корисні для загального розуміння тренду практики ВС, але не для цитування конкретної норми.

### 6.6 Динамічні BM25/title scores (вирішено)
BM25 score тепер динамічний: `0.25 + 0.30 × (matched_stems / total_stems)` → діапазон 0.25–0.55.  
Title boost score: `0.50 + 0.35 × (matched_kws / total_kws)` → діапазон 0.50–0.85.  
Слабкий keyword збіг (1 з 5 слів) → ~0.31; сильний (5 з 5) → 0.55. Reranker тепер бачить реальний сигнал якості.

**Що залишається:** Qdrant MatchText не дає справжній BM25 TF-IDF score — він binary (збіглось/ні). Справжній BM25 потребує sparse vectors і повного реіндексу.

---

## 7. Деплой

**Сервер:** `n-ai01.nexchance.de` (root)  
**Backend:** FastAPI + uvicorn, сервіс `backend.service`  
**Frontend:** Next.js, сервіс `frontend.service`

```bash
# Python зміни тільки:
cd /home/devops/app && git pull && systemctl restart backend.service

# JS/TS зміни:
npm run build && systemctl restart frontend.service

# Обидва:
npm run build && systemctl restart frontend.service && systemctl restart backend.service

# Логи backend:
journalctl -u backend.service -f

# Логи reindex (якщо запущено вручну):
tail -f /tmp/reindex_kmu.log
tail -f /tmp/reindex_rada.log
```

**Ключові env змінні** (`/home/devops/app/.env`):
- `QDRANT_URL` — адреса Qdrant (localhost:6333)
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Supabase
- Google Vertex AI credentials — через Supabase `app_settings` (не env файл)

---

## 8. Адмін-панель (`/admin`)

| Розділ | Що робить |
|--------|-----------|
| Огляд | Статистика всіх синхронізацій, останні запуски |
| Рада | Запуск/пауза/відновлення scraper rada_*, розклад |
| Верховний Суд | Scraper laws_supreme (PDF) |
| КСУ | Scraper laws_ccu |
| Позиції ВС | Scraper laws_positions (JSON API) |
| КМУ | Scraper laws_kmu |
| **Переіндекс** | Full reindex КМУ і Ради з live-логами (chunk 4000/3000 + title-prefix) |
| Покриття бази | Які секції Ради вже є в базі |
| AI Модель | Зміна системного промпту, моделі, thresholds |
| Онбординг | Тексти онбордингу |
| База знань | Вручну додати документи |
| Аналітика | Статистика чатів, популярні питання |
| Тарифи | Плани підписки, фічі, ціни |
| Користувачі | Список користувачів, статус підписки |
