# Qdrant V2 Collections Structure

Документ фиксирует фактическую структуру payload у V2 коллекций Qdrant и то, как эти метаданные используются в retrieval/chat pipeline.

Актуальная модель эмбеддингов: `gemini-embedding-001`, `3072 dims`.

## Общая схема

Все V2 коллекции хранят чанки документов. Один документ обычно имеет несколько точек, связанных через `law_id`; порядок чанков задает `chunk_index`.

Базовые payload-поля, которые есть почти во всех коллекциях:

- `source` — человекочитаемое название источника/документа.
- `law_id` — стабильный ID документа внутри URAI.
- `law_url` — ссылка на первоисточник.
- `law_domain` — имя Qdrant коллекции.
- `category` — категория источника.
- `doc_type` — тип документа, если известен.
- `status` — базовый статус, если известен.
- `doc_number` — номер документа, если известен.
- `author` — орган/автор, если известен.
- `date_adopted` — дата принятия, если известна.
- `effective_date` — дата вступления в силу, если известна.
- `is_retroactive`, `wartime_only`, `is_suspended`, `has_transitional` — базовые флаги.
- `scraped_at` — дата загрузки.
- `chunk_index` — индекс чанка внутри документа.
- `content` — текст чанка.

На момент проверки live Qdrant payload schema индексировал только:

- `content`
- `source`

После внедрения document registry добавляются/создаются payload indexes:

- `law_id`
- `chunk_index`

Это нужно для быстрого rebuild registry и быстрого получения чанков выбранного документа.

## Rada Collections

Коллекции:

- `rada_finance_v2`
- `rada_state_v2`
- `rada_personnel_v2`
- `rada_court_v2`
- `rada_intl_v2`
- `rada_labor_v2`
- `rada_civil_v2`
- `rada_criminal_v2`
- `rada_admin_v2`
- `rada_housing_v2`
- `rada_land_v2`
- `rada_industry_v2`
- `rada_other_v2`

Роль в retrieval: `primary_norm`.

Rada имеет самые полезные метаданные для юридического ответа. После OpenData enrichment и Qdrant payload patch в payload появляются:

- `rada_title` — нормальное название акта.
- `rada_url` — ссылка на `zakon.rada.gov.ua`.
- `rada_nreg` — регистрационный номер.
- `rada_n_vlas` — внутренний номер.
- `rada_dokid` — ID документа в Rada/OpenData.
- `rada_doc_type` — основной тип: `Кодекс`, `Закон`, `Постанова`, etc.
- `rada_doc_types` — все типы/классификации документа.
- `rada_status` — числовой статус.
- `rada_status_name` — человекочитаемый статус, например `Чинний` или `Втратив чинність`.
- `rada_is_dead` — главный флаг неактуальности.
- `rada_is_dead_by_status` — неактуальность по статусу.
- `rada_is_dead_by_link` — неактуальность по связям.
- `rada_is_dead_by_text` — неактуальность, извлеченная из текста.
- `rada_dead_since` — дата утраты чинності, если известна.
- `rada_replaced_by` — чем заменен документ.
- `rada_cancelled_by` — чем отменен документ.
- `rada_cancelled_by_text` — текстовые связи отмены.
- `rada_no_text` — нет полного текста.
- `rada_adopted_date` — дата принятия.
- `rada_last_edition` — дата последней редакции.
- `rada_theme` — тема.
- `rada_classifiers` — классификаторы.
- `rada_org` — орган.
- `rada_org_id` — ID органа.
- `rada_tags` — теги.
- `rada_minjust` — данные Минюста, если есть.
- `rada_editions_cnt` — количество редакций.
- `rada_enriched_at` — дата enrichment.

Практическое использование:

- Для общих юридических вопросов Rada должна быть основным источником.
- `rada_is_dead=True` документы не должны становиться основой ответа, если пользователь не спрашивает историческую редакцию/утрату чинності.
- `rada_doc_type` используется для буста кодексов, законов, постанов и порядков.
- `rada_title`, `rada_theme`, `rada_classifiers`, `rada_org` используются для document registry title matching.

Пример live payload:

- `law_id`: `2755-17`
- `rada_title`: `Податковий кодекс України`
- `rada_doc_type`: `Кодекс`
- `rada_status_name`: `Чинний`
- `rada_is_dead`: `False`
- `rada_last_edition`: `2026-04-15`

## KMU Collection

Коллекция:

- `laws_kmu_v2`

Роль в retrieval: `primary_norm`.

KMU использует тот же enriched `rada_*` слой, потому что документы KMU также доступны через `zakon.rada.gov.ua`.

Важные поля:

- `source` — обычно начинается с `КМУ: ...`.
- `law_id` — часто с префиксом `kmu_`.
- `doc_type` — например `НПА КМУ`.
- `category` — например `НПА КМУ`.
- `rada_title`
- `rada_doc_type`
- `rada_status_name`
- `rada_is_dead`
- `rada_dead_since`
- `rada_replaced_by`
- `rada_last_edition`
- `rada_org` — обычно `Кабінет Міністрів України`.

Практическое использование:

- KMU является основным нормативным источником рядом с Rada.
- Нужно обязательно учитывать `rada_is_dead` и `rada_status_name`.
- Постановы/порядки KMU часто являются практической процедурой к законам, поэтому должны попадать в контекст вместе с законом, если вопрос о действиях/процедуре.

Пример live payload:

- `law_id`: `kmu_261-2025-%D0%BF`
- `rada_title`: `Про внесення змін ...`
- `rada_doc_type`: `Постанова`
- `rada_status_name`: `Чинний`
- `rada_org`: `Кабінет Міністрів України`

Пример неактуального payload:

- `law_id`: `kmu_238-91-%D0%BF`
- `rada_status_name`: `Втратив чинність`
- `rada_is_dead`: `True`
- `rada_dead_since`: `1997-11-17`
- `rada_replaced_by`: `1279-97-п`

## MOD Collection

Коллекция:

- `laws_mod_v2`

Роль в retrieval: `official_norm`.

MOD содержит документы с сайта `mod.gov.ua`. Метаданные беднее, чем у Rada/KMU.

Фактические поля:

- базовые поля `source`, `law_id`, `law_url`, `category`, `doc_type`, `scraped_at`, `chunk_index`, `content`.
- нет enriched `rada_*` статусов.

Практическое использование:

- Использовать как официальный источник профильного органа.
- Не считать автоматически актуальным/неактуальным через `rada_is_dead`, потому что такого поля нет.
- Для общих вопросов MOD не должен вытеснять Rada/KMU, но важен для военной/оборонной тематики.

## ZIR Collection

Коллекция:

- `laws_zir_v2`

Роль в retrieval: `tax_consultation`.

ZIR содержит налоговые вопросы-ответы с `zir.tax.gov.ua`.

Фактические поля:

- `source` — вопрос, обычно начинается с `ЗІР ДПС: ...`.
- `law_id` — формат `zir_<id>`.
- `law_url` — ссылка на вопрос в ZIR.
- `category` — категория/рубрика вопроса.
- базовые поля `chunk_index`, `content`, `scraped_at`, etc.

Практическое использование:

- Использовать как практическое налоговое разъяснение.
- Не использовать как первичную норму вместо НКУ, закона или постановления.
- В налоговых вопросах ZIR полезен после Rada/KMU, чтобы объяснить прикладную позицию ДПС.

## Supreme Court Collection

Коллекция:

- `laws_supreme_v2`

Роль в retrieval: `court_practice`.

Содержит обзоры судебной практики Верховного Суда.

Фактические поля:

- `source` — название обзора.
- `law_id` — ID обзора/PDF.
- `law_url` — PDF на `court.gov.ua` или `supreme.court.gov.ua`.
- `author` — `Верховний Суд`.
- `category` — `Судова практика`.
- `doc_type` — `Огляд судової практики`.

Практическое использование:

- Использовать, когда пользователь спрашивает про судовую практику, споры, позицию суда, риск судебного спора.
- Не использовать как основную норму вместо закона.

## CCU Collection

Коллекция:

- `laws_ccu_v2`

Роль в retrieval: `court_practice`.

Содержит материалы/решения Конституционного Суда Украины.

Фактические поля:

- `source` — название материала КСУ.
- `law_id` — формат `ccu_<номер>`.
- `law_url` — документ на `ccu.gov.ua`.
- `author` — автор/судья, если известен.
- `category` — `Конституційний Суд України`.
- `doc_type` — тип документа, часто `Інше`.
- `doc_number`
- `date_adopted`
- `effective_date`

Практическое использование:

- Использовать для конституционно-правовых вопросов и толкования.
- Не смешивать как равный источник с обычными законами, если пользователь не спрашивает про КСУ/конституционность.

## Legal Positions Collection

Коллекция:

- `laws_positions_v2`

Роль в retrieval: `court_practice`.

Содержит правовые позиции с `lpd.court.gov.ua`.

Фактические поля:

- `source` — название правовой позиции.
- `law_id` — формат `lpd_<id>`.
- `law_url` — ссылка на правовую позицию.
- `author` — суд/палата, например `КГС ВС`.
- `category` — категория правовой позиции.
- `doc_type` — `Правова позиція`.

Практическое использование:

- Использовать для вопросов о судебной практике и оценке судебных рисков.
- Не использовать как основной источник общей нормы.

## Wiki Collection

Коллекция:

- `laws_wiki_v2`

Роль в retrieval: `explanation`.

Содержит справочные статьи `legalaid.wiki`.

Фактические поля:

- `source` — `Wiki: <название>`.
- `law_id` — формат `wiki_<hash>`.
- `law_url` — страница `legalaid.wiki`.
- `author` — `legalaid.wiki`.
- `category` — `Роз'яснення та шаблони`.
- `doc_type` — `Стаття Wiki`.

Практическое использование:

- Только вспомогательное объяснение.
- Не использовать как юридическую основу, если есть Rada/KMU или официальный источник.
- Хорошо подходит для простого пользовательского объяснения, но ответ должен ссылаться на первичные нормы там, где это возможно.

## Document Registry

Файл:

- `backend/document_registry_v2.json`

Builder:

- `backend/document_registry.py`
- ручной запуск: `python backend/rebuild_document_registry.py`

Pipeline:

- registry перестраивается последним шагом после `Патч Qdrant payload`.

Что хранит registry:

- `collection`
- `law_id`
- `title`
- `source`
- `url`
- `doc_type`
- `doc_types`
- `category`
- `theme`
- `classifiers`
- `org`
- `status`
- `status_name`
- `is_dead`
- `dead_since`
- `last_edition`
- `adopted_date`
- `replaced_by`
- `source_role`
- `search_text`

Зачем нужен:

- заменить тяжелый `title boost`, который раньше скроллил Qdrant по `source/content`;
- быстро найти правильный документ по названию, типу, теме, органу, статусу;
- не тащить `Втратив чинність` документы как основу ответа;
- разделять роли источников: primary norm, official norm, tax consultation, court practice, explanation.

Source roles:

- `primary_norm` — Rada, KMU.
- `official_norm` — MOD.
- `tax_consultation` — ZIR.
- `court_practice` — Supreme, CCU, Legal Positions.
- `explanation` — Wiki.

## Retrieval Rules

1. Rada/KMU имеют приоритет для юридических норм.
2. `rada_is_dead=True` понижается или исключается, если пользователь не спрашивает историческую редакцию/утрату чинності.
3. MOD используется как официальный профильный источник, но без автоматической проверки `rada_is_dead`.
4. ZIR используется как налоговое практическое разъяснение, не как закон.
5. Supreme/CCU/Positions используются как судебная практика, когда это релевантно.
6. Wiki используется только как объяснительный слой.
7. Конкретные документы про отдельные предприятия, объекты, аукционы, приватизацию или закупки не должны становиться основой общего ответа, если пользователь не спрашивает именно этот объект.
