# URAI — Технічна архітектура чатбота

> Документ для онбордингу AI-агентів та розробників.  
> Описує реальний стан системи станом на квітень 2026.  
> Без вигадок — тільки те, що є в коді.

---

## 1. Загальна схема роботи чатбота

```
Питання користувача
        │
        ▼
[1] Переклад RU→UA (якщо потрібно)
        │
        ▼
[2] Query Rewrite — Gemini переформульовує в юридичний стиль
        │
        ├──────────────────────┐
        ▼                      ▼
[3a] embed(оригінал)   [3b] embed(rewrite)
        │                      │
        ▼                      ▼
[4] Паралельний vector search по Qdrant колекціях
     └─ merge по max score (дедуплікація)
        │
        ▼
[5] Source boost (Рада/КМУ/CCU × 1.15)
        │
        ▼
[6] Diversity cap:
     - laws_supreme: max max_docs//4 слотів
     - laws_positions: max max_docs//4 слотів
     - Решта колекцій: guaranteed 2 слоти кожна + overflow
     - Max 2 чанки з одного law_id
        │
        ▼
[7] Keyword search (BM25 MatchText на поле content)
     └─ фільтр: stem keywords мають бути в source
        │
        ▼
[8] Title boost (MatchText на поле source по keywords з питання + rewrite)
        │
        ▼
[9] Trim до max_docs (з плану користувача)
        │
        ▼
[10] Gemini — генерує відповідь по контексту
        │
        ▼
[11] JSON відповідь: { answer, references, templates, _meta }
```

---

## 2. Qdrant — структура бази

### 2.1 Всі колекції (18 штук)

| Колекція | Джерело | Що зберігається | Розмір чанку |
|----------|---------|-----------------|--------------|
| `rada_finance` | zakon.rada.gov.ua | Фінанси, банки, податки, ПДВ, митниця (h2, h3, h26, h23) | ~1500 символів |
| `rada_state` | zakon.rada.gov.ua | Держустрій, громадянство (h4) — 25K+ документів | ~1500 символів |
| `rada_personnel` | zakon.rada.gov.ua | Кадрові питання, нагородження (h27) — 24K+ документів | ~1500 символів |
| `rada_court` | zakon.rada.gov.ua | Суд, прокуратура, юстиція, господарський процес (h22, h30, h1) | ~1500 символів |
| `rada_intl` | zakon.rada.gov.ua | Міжнародні відносини, договори (h11) | ~1500 символів |
| `rada_labor` | zakon.rada.gov.ua | Трудові відносини, соціальне страхування (h19, h20) | ~1500 символів |
| `rada_civil` | zakon.rada.gov.ua | Цивільне, сімейне, охорона здоров'я, нотаріат (h5, h16, h13) | ~1500 символів |
| `rada_criminal` | zakon.rada.gov.ua | Кримінальне та процесуальне (h25) | ~1500 символів |
| `rada_admin` | zakon.rada.gov.ua | Адміністративна відповідальність, ліцензування (h8, h10, h31) | ~1500 символів |
| `rada_housing` | zakon.rada.gov.ua | Житлове, ЖКГ, будівництво (h6, h21) | ~1500 символів |
| `rada_land` | zakon.rada.gov.ua | Земельне, сільське господарство (h9, h18) | ~1500 символів |
| `rada_industry` | zakon.rada.gov.ua | Транспорт, промисловість, підприємства (h7, h17, h15) | ~1500 символів |
| `rada_other` | zakon.rada.gov.ua | Освіта, наука, культура, ЗСУ, торгівля (h12, h14, h24, h28, h29, h32) | ~1500 символів |
| `laws_kmu` | zakon.rada.gov.ua/laws/main/o2 | НПА Кабінету Міністрів (постанови, розпорядження, накази) | ~1500 символів |
| `laws_supreme` | supreme.court.gov.ua/supreme/analiz | Квартальні PDF-огляди практики Верховного Суду | ~1500 символів |
| `laws_wiki` | legalaid.wiki | Вікі-статті правової допомоги | ~1500 символів |
| `laws_ccu` | ccu.gov.ua | Рішення (-р) та Висновки (-в) Конституційного Суду | ~1500 символів |
| `laws_positions` | lpd.court.gov.ua API | Відформульовані правові позиції ВС (~12 800 позицій) | ~2000 символів |

**Вектор:** 768 вимірів, cosine distance, модель `text-embedding-004` (Google Vertex AI)

---

### 2.2 Payload (поля) кожного документа в Qdrant

Кожен point = один чанк (уривок) документа. Поля:

```json
{
  "content":        "Текст чанку — відправляється в Gemini",
  "source":         "Заголовок документа (для пошуку і відображення)",
  "law_id":         "Унікальний ID документа (наприклад: kmu_663-99-%D0%BF)",
  "doc_type":       "Постанова КМУ / Правова позиція / Рішення КСУ / ...",
  "category":       "Галузь права / тип документа",
  "law_url":        "Пряме посилання на документ",
  "source_domain":  "zakon.rada.gov.ua / lpd.court.gov.ua / ...",
  "status":         "Чинний / Втратив чинність / ...",
  "doc_number":     "Номер документа",
  "date_adopted":   "Дата прийняття",
  "scraped_at":     "ISO datetime індексування",
  "chunk_index":    0,
  "law_domain":     "Назва колекції",

  // Тільки для laws_kmu:
  "effective_date": "Дата набуття чинності",

  // Тільки для laws_positions:
  "lpd_id":         123456,
  "title":          "Назва правової позиції",
  "court_tag":      "Велика Палата / КАС / КЦС / ККС / КГС",
  "court_abbr":     "ВП ВС",
  "categories":     "категорія1, категорія2",
  "case_numbers":   "справа1, справа2",
  "approved_at":    "дата затвердження",
  "updated_at":     "дата оновлення",

  // Тільки для laws_ccu:
  "doc_subtype":    "Рішення / Висновок",

  // Тільки для laws_supreme:
  "pdf_url":        "пряме посилання на PDF",

  // Тільки для laws_wiki:
  "wiki_title":     "Назва статті legalaid.wiki"
}
```

**Повнотекстові індекси (BM25):** поля `content` і `source` проіндексовані для keyword search.

---

### 2.3 Як документи потрапляють в базу

| Колекція | Скрапер | Логіка |
|----------|---------|--------|
| `rada_*` | `rada_scanner.py` + `rada_to_supabase.py` | Ітерує сторінки zakon.rada.gov.ua по тематичних розділах (h2, h3...), витягує текст закону, конвертує в Markdown, ріже на чанки ~1500 символів, embed → Qdrant |
| `laws_kmu` | `kmu_scanner.py` | Скрапить zakon.rada.gov.ua/laws/main/o2 (документи видавника КМУ), `law_id = "kmu_" + rada_id`, чанк ~1500 символів без title-prefix |
| `laws_supreme` | `supreme_scanner.py` | PDF-файли з supreme.court.gov.ua, розпізнаються через PyPDFLoader, чанки ~1500 символів |
| `laws_wiki` | `wiki_scanner.py` | MediaWiki API legalaid.wiki, чанки ~1500 символів |
| `laws_ccu` | `ccu_scanner.py` | HTTP скрапінг ccu.gov.ua, PDF розпізнавання, чанки ~1500 символів |
| `laws_positions` | `lpd_scanner.py` | JSON API lpd.court.gov.ua, чистий текст, title вставляється в початок першого чанку, чанки ~2000 символів |

**Incremental sync:** при кожному запуску скрапер перевіряє `get_existing_law_ids()` і пропускає вже проіндексовані документи (по `law_id`).

---

## 3. Pipeline `/ask` — детально

### 3.1 Вхідний запит

```python
POST /ask
{
  "question": "Як розрахувати лікарняні?",
  "max_docs": 12,              # з плану підписки (8–20)
  "filter_sources": ["rada", "kmu"],  # null = всі
  "response_features": ["response_detailed", "response_steps"],
  "user_profile": {"role": "юрист", "sub_role": ["трудове"]},
  "history": [{"role": "user", "content": "..."}],
  "ai_personal_prompt": "Відповідай коротко."
}
```

### 3.2 Крок 1 — Preprocessing

1. **Детект мови:** якщо питання містить "ы/ъ/э" і не містить "і/ї/є/ґ" — переводить через Gemini `RU→UA`
2. **Query Rewrite:** Gemini (temperature=0, max_tokens=150) переформульовує в юридичний стиль:
   - "як платять відрядні за кордон" → "порядок нарахування добових витрат при закордонному відрядженні"
3. **Parallel embed:** `embed(original)` + `embed(rewrite)` паралельно через Vertex AI `text-embedding-004`

### 3.3 Крок 2 — Routing

**Intent classifier:** Gemini визначає галузь права → маппінг на колекції:

| Intent | Колекції |
|--------|----------|
| трудове | rada_labor, laws_kmu, laws_positions, laws_supreme |
| податкове / фінансове | rada_finance, laws_kmu, laws_positions, laws_supreme |
| цивільне | rada_civil, laws_positions, laws_supreme |
| кримінальне | rada_criminal, laws_positions, laws_supreme, laws_ccu |
| адміністративне | rada_admin, rada_state, laws_positions, laws_supreme |
| земельне | rada_land, laws_kmu, laws_positions |
| житлове | rada_housing, laws_kmu, laws_positions |
| кадрове | rada_personnel, rada_labor, laws_kmu, laws_positions |
| судове | laws_positions, laws_supreme, laws_ccu, rada_court |
| інше | всі колекції |

Додатково фільтруються `filter_sources` з плану підписки (наприклад free план не отримує `laws_ccu`).

### 3.4 Крок 3 — Multi-query Vector Search

- `fetch_k = max_docs × 3` кандидатів з кожної колекції
- Паралельний пошук по всіх target_collections через ThreadPoolExecutor
- Два пошуки: `search(embed_original, fetch_k)` + `search(embed_rewrite, fetch_k)`
- **Merge:** дедуп по `(law_id, chunk_index)`, зберігаємо max score
- `match_threshold = max(0.33, settings.match_threshold_docs)` — відсікаємо нерелевантне

### 3.5 Крок 4 — Boost та Diversity Cap

**Source boost (×1.15):** лише `rada_*` та `laws_positions` (закони Ради пріоритетніші за wiki/supreme)

**Dedup по law_id:** max 2 чанки від одного документа — щоб один документ не зайняв усі слоти

**Diversity cap:**
```
laws_positions → max(1, max_docs // 4) слотів
laws_supreme   → max(2, max_docs // 4) слотів
Інші колекції  → гарантовано max(2, (max_docs×3//4) // n_cols) слотів кожна
Overflow       → конкуренція по similarity до залишку max_docs
```

### 3.6 Крок 5 — Keyword Search (BM25)

`search_qdrant_text()`: MatchText по полю `content` для топ-4 термінів запиту  
Результати додаються тільки якщо stem ключового слова є в полі `source` документа  
Фіксований score = 0.45 (нижче vector результатів)

### 3.7 Крок 6 — Title Boost

`search_qdrant_by_title()`: MatchText по полю `source` (заголовок)  
Keywords = слова >4 символів з питання (до 3) + rewrite (до 7), punctuation stripped  
Документи ранжуються по кількості keyword matches  
Додає перші `chunks_per_doc=3` чанки найбільш матчених документів  
Фіксований score = 0.75

### 3.8 Крок 7 — Final trim + Filter

- `results = results[:max_docs]` — обрізаємо до ліміту плану
- Видаляємо документи зі статусом "Втратив чинність / Втратила чинність"
- Розподіл контексту для Gemini: `law_chunks` | `kmu_chunks` | `court_chunks`

### 3.9 Крок 8 — Gemini Response

Модель: `gemini-2.0-flash-001` (або з `app_settings`)  
System prompt: береться з Supabase таблиці `app_settings`, ключ `system_prompt`  

Prompt структура:
```
[Профіль користувача: роль, спеціалізація]
[Персональний AI-контекст]
[Попередній діалог: останні 6 turns]
Контекст з українського законодавства:
  --- Закони Ради ---
  [1] Назва | Тип | № | Статус | Дата
  ---
  текст чанку
  
  --- Постанови КМУ ---
  ...
  --- Судова практика ---
  ...
---
Питання: ...
[Response instructions: деталізація, кроки, ліміт слів]
```

Паралельно запускається класифікатор (sentiment, complexity, user_intent) — не впливає на відповідь, тільки для аналітики.

---

## 4. Налаштування системи (Supabase app_settings)

| Ключ | Тип | Default | Опис |
|------|-----|---------|------|
| `ai_model` | string | `gemini-2.0-flash-001` | Модель Gemini |
| `embedding_model` | string | `text-embedding-004` | Embedding модель Vertex AI |
| `temperature` | float | `0.1` | Температура генерації |
| `top_p` | float | `0.8` | Top-p sampling |
| `max_output_tokens` | float | `8000` | Ліміт токенів відповіді |
| `match_threshold_docs` | float | `0.35` | Мін. threshold для vector search |
| `min_relevance_score` | float | `0.35` | Мін. score для hard-stop |
| `rada_source_boost` | float | `1.15` | Буст для законів Ради та laws_positions |
| `system_prompt` | string | fallback | Системний промпт Gemini |
| `llm_timeout_seconds` | float | `90.0` | Timeout для Gemini |

---

## 5. Плани підписки → параметри пошуку

З таблиці `subscription_plans` береться `max_docs_retrieved` (8–20 чанків).  
З таблиці `plan_features` береться набір фіч:

| Feature key | Що вмикає |
|-------------|-----------|
| `source_rada` | Пошук по `rada_*` колекціях |
| `source_kmu` | Пошук по `laws_kmu` |
| `source_supreme` | Пошук по `laws_supreme` |
| `source_ccu` | Пошук по `laws_ccu` |
| `source_legalaid` | Пошук по `laws_wiki` |
| `source_lpd` | Пошук по `laws_positions` |
| `response_detailed` | Розгорнута відповідь (ліміт 800 слів) |
| `response_steps` | Блок "Що робити далі" |
| `response_scenarios` | Альтернативні сценарії |
| `response_vs_position` | Посилання на позиції ВС |

---

## 6. Відомі обмеження та проблеми

### 6.1 Морфологічна прірва (головна проблема retrieval)
Embedding модель не завжди перекидає місток між:
- Розмовна форма: `"відрядні"` (виплата)
- Юридична форма: `"відшкодування витрат на відрядження"` (офіційна назва)

**Mitigation:** Query Rewrite (Gemini) перед embed.  
**Не вирішено:** MatchText (BM25) не має стемінгу для української мови — `"відрядних"` ≠ `"відрядження"`.

### 6.2 Квартальні огляди ВС (laws_supreme) — широкий матч
`sc_Oglyad_KGS_05_2025` та подібні документи покривають багато тем і отримують score 0.70+ на майже будь-який правовий запит. Обмежені до `max_docs//4` слотів.

### 6.3 Чанки-таблиці без контексту
Документи типу "норми добових по країнах" містять таблиці без описового тексту — embedding слабкий.  
**Mitigation:** title-prefix при індексуванні (є в `reindex_kmu_docs.py` для kmu_663-99 та kmu_98-2011, але потребує запуску на сервері).

### 6.4 Intent classifier — один вибір
Gemini вибирає одну галузь права. Питання що стосуються двох галузей (трудове + податкове) шукаються тільки в одній.

---

## 7. Деплой

**Сервер:** `n-ai01.nexchance.de` (root)  
**Backend:** FastAPI + uvicorn, сервіс `backend.service`  
**Frontend:** Next.js, сервіс `frontend.service`

```bash
# Python зміни:
cd /home/devops/app && git pull && systemctl restart backend.service

# JS/TS зміни:
npm run build && systemctl restart frontend.service

# Обидва:
npm run build && systemctl restart frontend.service && systemctl restart backend.service

# Логи backend:
journalctl -u backend.service -f
```

**Ключові env змінні** (на сервері в `/home/devops/app/.env`):
- `QDRANT_URL` — адреса Qdrant (localhost:6333)
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Supabase
- Google Vertex AI credentials — через Supabase `app_settings` (не env файл)
