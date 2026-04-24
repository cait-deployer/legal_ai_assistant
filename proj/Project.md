# Project: AI Assistant (Telegram Bot)

## Commands
- Update & deploy: `py _update.py` — загружает файлы на VPS + перезапускает бот
- Full deploy (first time): `py _deploy.py`
- Logs: SSH → `journalctl -u ai-assistant -n 50 --no-pager`
- VPS: `ssh root@195.181.243.2` (systemd service: `ai-assistant`)
- Bot runs in: `/opt/ai-assistant/.venv/bin/python`

## Architecture
Слои: `bot/` (Telegram I/O) → `agents/` (AI логика) → `config/` (настройки)
`agents/` не знает о Telegram. `bot/` не содержит AI логики.

### agents/ — AI логика (не знает о Telegram)
- `chat_agent.py` — единственный агент диалога, MISSION, история + Qdrant, respond_stream()
- `gemini_vision.py` — /info: YouTube/соцсети/статьи/документы → Gemini summary
- `file_processor.py` — обработка фото, видео, аудио, документов, голоса
- `qdrant_store.py` — ЕДИНСТВЕННЫЙ интерфейс к Qdrant, не обходить
- `gemini_compiler.py` — ЕДИНСТВЕННЫЙ интерфейс к Gemini API, не обходить
- `gemini_indexer.py` — индексация Obsidian в Qdrant

### bot/ — Telegram интерфейс
- `router.py` — маршрутизация: info_mode → URL-only → chat_agent.respond_stream()
- `session_cache.py` — состояния: info_mode, pending_content (TTL=2s)
- `utils.py` — safe_reply() чанкинг 4096
- `main.py` — регистрация хендлеров, group=-1 сбрасывает info_mode на любую команду
- `commands/` — хендлеры команд (/add, /info, /reset…)
- `handlers/` — хендлеры сообщений (медиа)

### config/
- `settings.py` — все настройки через .env

## Key flows
- `/info` → set_info_mode → любой текст/URL/медиа в info_mode обрабатывается
- URL в любом сообщении → автоматически идёт в gemini_vision.summarize()
- Pending buffer: медиа за 2 сек до /info буферизуется → показывается по команде
- YouTube: Gemini direct URL → transcript API → yt-dlp авто-субтитры → yt-dlp metadata fallback
- Все текстовые и медиа сообщения → chat_agent.respond_stream() (MISSION + tools + typing indicator)

## Prompts (gemini_vision.py)
- `FULL_CONTENT_PROMPT` — полный транскрипт/статья/документ: 4-6 разделов подробно
- `SHORT_CONTENT_PROMPT` — Shorts/соцсети/метаданные: 3-4 раздела кратко
- `TITLE_ONLY_PROMPT` — только название без транскрипта: 3-5 предложений, без выдумок

## Commands (Telegram)
- `/info` — анализ URL/текста/медиа, включает info_mode
- `/add` — сохранить заметку в Obsidian + Qdrant
- `/remove` — удалить из Qdrant и Obsidian
- `/sync` — синхронизация vault → Qdrant
- `/index` — анализ и реструктуризация vault
- `/reset` — сбросить историю чата

## Don'ts
- Не редактировать `.env`, `_update.py` содержит VPS credentials — не коммитить
- Не менять структуру папок без необходимости
- Не добавлять пакеты в код без `requirements.txt`
- Не вызывать Gemini API напрямую — только через `agents/gemini_compiler.py`
- Не очищать info_mode в хендлерах — только через group=-1 в main.py

## Deploy rule
- Перед каждым деплоем (`py _update.py`) — обновить `DEVLOG.md`: добавить запись с датой, что изменилось, зачем, какое решение принято
- Перед деплоем **обязательно** запустить `/review` — деплой без review запрещён

## Prompt engineering rule
- Изменения system prompt'ов (MISSION, любые инструкции агентам) = code-level изменения
- Требуют того же цикла: план → код → review → деплой
- Перед написанием правила: это доменное ограничение ("нет доступа к X") или кейс-ограничение ("не говори Y")? Кейс-ограничения — признак что не найдена причина

## Architecture decision rule
- Перед любым архитектурным решением (новый модуль, слияние/разделение агентов, изменение потока данных) — запустить субагент `architect`
- Claude **всегда** даёт свою рекомендацию с аргументом перед запуском архитектора — чтобы получить независимое второе мнение, а не подтверждение
- Architect предлагает альтернативы — финальное решение принимает Игорь

## Fix rule
- Перед любым фиксом (код или промпт): это симптом или причина?
  - Симптом → найди причину, исправь её
  - Причина → определи класс проблемы → реализуй на правильном уровне абстракции