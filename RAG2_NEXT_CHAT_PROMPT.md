# Prompt for Next Chat: URAI RAG 2 Implementation

Ты - senior fullstack architect, LLM/RAG engineer и аккуратный coding agent в проекте URAI Legal Assistant.

Цель: довести RAG 2 до максимально точных, быстрых и недорогих юридических ответов. Нельзя ломать текущую рабочую версию. Все изменения должны быть маленькими, проверяемыми и обратимыми.

## Контекст проекта

URAI - украинский юридический AI assistant на Next.js + Supabase + backend RAG. Пользователь задает юридический вопрос, система ищет источники по коллекциям, формирует контекст и генерирует ответ с citations.

Уже есть:
- широкое RAG-поиск-покрытие по коллекциям;
- сохранение сообщений в `messages`;
- `messages.citations jsonb`;
- `query_analytics`;
- новый workflow для RAG eval:
  - SQL файл `supabase_rag_eval_cases.sql`;
  - `query_analytics.message_id`;
  - `query_analytics.ai_eval`;
  - таблица `rag_eval_cases`;
  - endpoint `POST /api/admin/analytics/[id]/evaluate`;
  - endpoint `PATCH /api/admin/analytics/[id]/evaluate`;
  - в админке Analytics кнопки `AI оцінити`, `Погодитись`, `Gold case`, `Виправити джерела`, `Rejected`.

Важно: AI eval - это только черновик. Истиной становится только `approved` / `gold` после human review.

## Главная проблема

Бот иногда:
- не находит прямую норму, хотя полезные источники есть;
- берет wiki/zir/судебку как слишком сильные источники;
- отвечает слишком осторожно или обрывает полный ответ;
- при нагрузке нескольких пользователей может тормозить или отдавать слабый ответ;
- иногда RAG делает слишком много дорогих шагов ради простого вопроса.

Нужно не хардкодить отдельные слова типа "ВЛК/ТЦК", а построить универсальный, обучаемый через eval-cases pipeline.

## Главный принцип RAG 2

Не делаем "магические правила под один вопрос".

Делаем систему:
1. Собирает реальные вопросы, ответы, citations и feedback.
2. AI предлагает eval-разметку.
3. Админ подтверждает или правит.
4. `approved/gold` cases становятся источником правды для:
   - evaluation set;
   - похожие вопросы -> проверенные источники;
   - калибровка reranker;
   - предупреждения по типам источников;
   - аналитика ошибок.

## Что нужно сделать дальше

### Phase 1. Проверить и закрепить RAG eval базу

1. Убедиться, что `supabase_rag_eval_cases.sql` применен в базе.
2. Проверить в админке Analytics:
   - кнопка `AI оцінити` создает запись в `rag_eval_cases`;
   - `query_analytics.ai_eval` заполняется;
   - `actual_sources` реально берутся из `messages.citations`;
   - `Погодитись` переводит в `approved`;
   - `Gold case` ставит `is_gold = true`;
   - `Виправити джерела` сохраняет правки.
3. Если есть ошибки - фиксить минимально, не трогая RAG retrieval.

### Phase 2. Сделать admin workflow удобным

Нужно добавить нормальный интерфейс разметки, не только JSON textarea:
- список actual citations;
- чекбокс "expected";
- чекбокс "bad";
- поле reason;
- selector `answer_type`;
- selector `has_direct_answer`;
- кнопки:
  - `Approve`
  - `Reject`
  - `Gold`
  - `Add to eval set`

Важно: человек должен размечать кейс за 20-40 секунд.

### Phase 3. Создать eval runner

Нужен endpoint или backend script, который:
1. Берет `rag_eval_cases where status='approved' or is_gold=true`.
2. Для каждого кейса запускает текущий RAG retrieval без генерации полного ответа.
3. Сравнивает:
   - попали ли `expected_sources` в top-K;
   - попали ли `bad_sources` слишком высоко;
   - есть ли прямой источник, если `has_direct_answer=true`;
   - сколько времени занял retrieval.
4. Пишет результат в новую таблицу или JSON report:
   - hit@5;
   - hit@10;
   - bad_source_rate;
   - avg retrieval time;
   - missed expected sources.

Это даст измеримость. Без eval runner любые "улучшения" будут на глаз.

### Phase 4. Сделать universal source quality scoring

Не хардкодить "MOD выше wiki".

Нужно сделать универсальную формулу source score:

FinalScore =
  vector_score
  + lexical_overlap
  + title_match
  + source_authority
  + directness_score
  + gold_case_similarity_boost
  - background_only_penalty
  - bad_source_similarity_penalty

Важно:
- перед сложением скоров обязательно привести их к одному масштабу;
- нельзя напрямую складывать cosine/vector score с BM25 или другими raw lexical scores;
- используй Min-Max normalization, Z-score или другой явно описанный способ нормализации;
- после нормализации все компоненты должны быть сопоставимы, например 0..1;
- веса должны быть feature-flagged/configurable, а не зашиты навсегда.

Где:
- `source_authority` не жесткий фильтр, а мягкий prior:
  - primary law / Rada / KМУ / MOD normative docs обычно выше;
  - court practice важна, но не должна заменять норму, если вопрос про прямую норму;
  - wiki/zir полезны как explanation/background, но не главный источник, если есть первичная норма;
- `directness_score` должен определяться не по коллекции, а по совпадению вопроса с нормой;
- `gold_case_similarity_boost` использовать только если новый вопрос похож на approved/gold case;
- `bad_source_similarity_penalty` снижает источники, которые люди уже пометили как плохие для похожих вопросов.

### Phase 5. Similar question memory

Нужно сделать легкую память проверенных кейсов:
- embedding вопроса из `rag_eval_cases`;
- при новом вопросе искать похожие approved/gold cases;
- если similarity высокая, добавить в retrieval hints:
  - expected sources;
  - bad sources;
  - answer_type;
  - has_direct_answer.

Важно:
- это не hardcode;
- это case-based learning;
- если похожесть низкая, ничего не форсировать.

Техническое уточнение:
- предложи лучший вариант хранения embeddings:
  - `pgvector` в Supabase, например колонка `embedding vector(1536)` в `rag_eval_cases`;
  - или отдельная легкая коллекция в Qdrant;
- выбор должен учитывать текущую архитектуру проекта, стоимость, скорость и простоту поддержки;
- не внедряй embeddings вслепую, сначала проверь, что уже используется для vector search в проекте.

### Phase 6. Answer contract

Ответ должен быть связан с `answer_type`:

- `direct_norm`: коротко дать норму, ссылку, вывод.
- `no_direct_norm`: честно сказать, что прямой нормы нет, но показать косвенную рамку и практический вывод.
- `procedure`: шаги, сроки, документы.
- `risk_analysis`: риски, варианты, последствия.
- `document_draft`: структура/черновик документа.
- `clarification_needed`: сначала уточняющий вопрос.
- `mixed`: комбинированный ответ.

Для полного ответа своими словами:
- не обрывать;
- если модель уперлась в лимит, backend должен продолжать continuation до завершения;
- frontend должен показывать текст только после полного сохранения или корректно stream-ить продолжение.

Техническое уточнение:
- если модель возвращает `finish_reason: length` или аналогичный сигнал об обрыве, сначала опиши архитектурный подход;
- варианты:
  - для `deep_path` увеличить `max_output_tokens` до безопасного максимума модели, например 8192, если модель/провайдер позволяет;
  - или делать автоматический continuation-запрос на backend, передавая уже сгенерированный хвост как контекст и требуя продолжить без повторения;
  - или гибрид: сначала высокий лимит, continuation только при реальном обрыве;
- не делать бесконечный цикл continuation: нужен max attempts, completion detector и понятный лог.

### Phase 7. Speed and cost

Нужно разделить запросы:

Fast path:
- простой вопрос;
- хороший top source найден;
- короткий/стандартный ответ;
- минимум rerank/generation.

Deep path:
- сложный вопрос;
- конфликт источников;
- нет прямой нормы;
- полный ответ;
- нужен rerank и больше источников.

Не каждый запрос должен проходить полный дорогой pipeline.

Routing:
- решение между `fast_path` и `deep_path` должен принимать отдельный быстрый routing step до основного дорогого retrieval;
- это может быть быстрый LLM-вызов с коротким JSON-ответом или легковесный классификатор;
- routing должен учитывать длину вопроса, юридическую сложность, наличие просьбы о полном анализе/документе, риск конфликта источников и требуемый answer_type;
- routing result нужно логировать, чтобы потом сравнить качество fast/deep решений.

Добавить метрики:
- retrieval_ms;
- rerank_ms;
- generation_ms;
- number_of_collections;
- number_of_chunks_before/after rerank;
- continuation_count;
- answer_complete true/false.

### Phase 8. Safe rollout

Все менять через feature flags:
- `rag2_eval_hints_enabled`;
- `rag2_gold_boost_enabled`;
- `rag2_source_quality_enabled`;
- `rag2_fast_path_enabled`;
- `rag2_deep_path_enabled`.

Сначала включать только для beta/admin.

## Что нельзя делать

- Не хардкодить отдельные темы типа "ВЛК", "ТЦК", "відстрочка" как единственную логику.
- Не отключать wiki/zir полностью. Они могут быть полезны как background, но не всегда как главный источник.
- Не повышать коллекцию глобально без eval evidence.
- Не ломать текущий широкий поиск.
- Не переписывать весь backend за один раз.
- Не использовать AI eval как финальную истину.
- Не делать дорогой pipeline для каждого вопроса.

## Первый практический шаг в новом чате

1. Прочитать:
   - `CHATBOT_FLOW.md`
   - `URAI_ARCHITECTURE.md`
   - `supabase_rag_eval_cases.sql`
   - backend RAG файлы, где происходит retrieval/rerank/generation.
2. Найти точные места:
   - где сохраняются `messages.citations`;
   - где формируется `FINAL RESULTS`;
   - где reranker выбирает chunks;
   - где строится финальный prompt;
   - где есть timing/logging.
3. Ничего не менять, пока не будет понятна реальная цепочка.
4. После чтения предложить конкретный маленький PR:
   - либо eval runner;
   - либо сохранение retrieved meta в analytics;
   - либо source-quality scoring behind feature flag.

## Definition of Done for RAG 2

RAG 2 можно считать реально полезным, когда:
- есть минимум 30-50 approved/gold eval cases;
- eval runner показывает hit@5/hit@10;
- bad sources реально снижаются на похожих вопросах;
- full answer не обрывается;
- fast path отвечает быстрее и дешевле;
- deep path дает более полный ответ без hardcode;
- все можно откатить feature flags.
