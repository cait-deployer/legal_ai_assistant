import os
import re
import traceback
import httpx
import threading
import datetime
from collections import deque
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google.genai import Client, types
from langchain_google_genai import GoogleGenerativeAIEmbeddings

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
AI_MODEL = os.environ.get("AI_MODEL")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

gemini = Client(api_key=GOOGLE_API_KEY)

embeddings = GoogleGenerativeAIEmbeddings(
    model=EMBEDDING_MODEL,
    google_api_key=GOOGLE_API_KEY
)

# ── COURT CASE DETECTOR ────────────────────────────────────────────────────

def try_fetch_court_case(text: str) -> str:
    """Виявляє номер судової справи та повертає інструкцію для AI."""
    case_pattern = r"\b\d{3}/\d+/\d{2}-[а-яіїєґ]+\b"
    match = re.search(case_pattern, text)
    if match:
        case_num = match.group(0)
        return (
            f"\n\n[СИСТЕМА: Користувач цікавиться конкретною справою №{case_num}. "
            f"Якщо в контексті немає цієї справи, повідом про це і поясни загальні "
            f"правила для такої категорії справ.]\n"
        )
    return ""


# ── RADA scraping state ────────────────────────────────────────────────────

_scraping_lock = threading.Lock()
_scraping_running = False
_scraping_logs: deque = deque(maxlen=1000)


def _add_log(message: str, level: str = "info"):
    _scraping_logs.append({
        "ts": datetime.datetime.now().isoformat(),
        "message": message,
        "level": level,
    })
    print(f"[{level.upper()}] {message}")


def _create_sync_log_entry() -> str | None:
    try:
        with httpx.Client() as client:
            r = client.post(
                f"{SUPABASE_URL}/rest/v1/sync_logs",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                },
                json={"status": "running", "started_at": datetime.datetime.now().isoformat()},
                timeout=5.0,
            )
            if r.status_code == 201:
                return r.json()[0].get("id")
    except Exception as e:
        print(f"⚠️ Could not create sync log entry: {e}")
    return None


def _write_sync_log_by_id(log_id, status, processed, error=None):
    payload = {
        "status": status,
        "finished_at": datetime.datetime.now().isoformat(),
        "laws_processed": processed,
    }
    if error:
        payload["error_message"] = error
    try:
        with httpx.Client() as client:
            client.patch(
                f"{SUPABASE_URL}/rest/v1/sync_logs?id=eq.{log_id}",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=5.0,
            )
    except Exception as e:
        print(f"⚠️ Could not update sync log: {e}")


def _run_sync_task():
    global _scraping_running

    if _scraping_running:
        print("⚠️ Скрапінг уже виконується, ігноруємо дублікат.")
        return

    with _scraping_lock:
        _scraping_running = True
        _scraping_logs.clear()

    session_id = None
    processed_total = 0

    try:
        session_id = _create_sync_log_entry()
        _add_log(f"🚀 Початок глобальної синхронізації (ID: {session_id})")

        # 1. RADA
        try:
            from rada_to_supabase import run_rada_sync
            _add_log("📡 Скрапінг Ради...")
            rada_res = run_rada_sync(log_callback=_add_log, session_id=session_id)
            processed_total += rada_res.get("processed", 0) if rada_res else 0
        except Exception as e:
            _add_log(f"❌ Помилка Ради: {e}", "error")

        # 2. WIKI
        try:
            from wiki_scanner import run_wiki_sync
            _add_log("📖 Запуск синхронізації Wiki...")
            run_wiki_sync(log_callback=_add_log, session_id=session_id)
        except ImportError:
            _add_log("⏭️ wiki_scanner не знайдено, пропускаємо.", "warning")
        except Exception as e:
            _add_log(f"❌ Помилка Wiki: {e}", "error")

        # 3. SUPREME COURT
        try:
            from supreme_scanner import run_supreme_sync
            _add_log("⚖️ Скрапінг Верховного Суду...")
            run_supreme_sync(session_id=session_id, log_callback=_add_log)
        except ImportError:
            _add_log("⏭️ supreme_scanner не знайдено, пропускаємо.", "warning")
        except Exception as e:
            _add_log(f"❌ Помилка Суду: {e}", "error")

        _add_log(f"🏁 Все завершено. Оброблено: {processed_total}", "success")
        if session_id:
            _write_sync_log_by_id(session_id, "success", processed_total)

    except Exception as e:
        _add_log(f"💥 Критичний збій: {e}", "error")
        if session_id:
            _write_sync_log_by_id(session_id, "error", 0, str(e))
    finally:
        _scraping_running = False


# ── Scheduler ─────────────────────────────────────────────────────────────
from apscheduler.schedulers.background import BackgroundScheduler

_scheduler = BackgroundScheduler()
_schedule_job = _scheduler.add_job(_run_sync_task, "cron", hour=1, minute=0)
# _scheduler.start()  # розкоментуй коли потрібен автозапуск


# ── Query model ────────────────────────────────────────────────────────────
class Query(BaseModel):
    question: str


def search_templates(query_vector: list, top_k: int = 3) -> list:
    """Векторний пошук по таблиці document_templates."""
    try:
        with httpx.Client() as client:
            response = client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/match_templates",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "query_embedding": query_vector,
                    "match_threshold": 0.3,
                    "match_count": top_k,
                },
                timeout=10.0,
            )
            if response.status_code != 200:
                print(f"⚠️ match_templates error: {response.text}")
                return []
            return response.json()
    except Exception as e:
        print(f"⚠️ search_templates error: {e}")
        return []


def search_supabase(query_vector: list, top_k: int = 10) -> list:
    try:
        with httpx.Client() as client:
            response = client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/match_documents",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "query_embedding": query_vector,
                    "match_threshold": 0.4,
                    "match_count": top_k,
                },
                timeout=10.0,
            )
            if response.status_code != 200:
                print(f"❌ Supabase search error: {response.text}")
                return []
            return response.json()
    except Exception as e:
        print(f"❌ Connection error: {str(e)}")
        return []


@app.post("/ask")
async def ask_lawyer(data: Query):
    print(f"🔍 ЗАПИТ: {data.question}")
    try:
        court_instruction = try_fetch_court_case(data.question)

        query_vector = embeddings.embed_query(data.question)

        # Паралельний пошук: закони + шаблони
        docs = search_supabase(query_vector, top_k=10)
        template_hits = search_templates(query_vector, top_k=3)

        if not docs and not template_hits:
            return {
                "answer": "Вибачте, у моїй базі знань поки немає інформації за цим запитом. Спробуйте уточнити питання.",
                "references": [],
                "templates": [],
            }

        context_parts = []
        seen_files = set()

        for i, d in enumerate(docs):
            content = d.get("out_content", "")
            meta = d.get("out_metadata", {})
            source_title = meta.get("source", "Документ")
            category = meta.get("category", "Загальне")

            context_parts.append(
                f"--- Джерело [{i+1}]: {source_title} ({category}) ---\n"
                f"Текст: {content}"
            )

            # Шаблони що прийшли з таблиці documents (wiki)
            file_url = meta.get("file_url")
            if file_url and file_url not in seen_files:
                seen_files.add(file_url)

        context = "\n\n".join(context_parts)

        # Шаблони з document_templates — головне джерело файлів
        templates = []
        for t in template_hits:
            file_url = t.get("file_url", "")
            if file_url and file_url not in seen_files:
                templates.append({
                    "title": t.get("title", "Шаблон"),
                    "url": file_url,
                    "category": t.get("category", ""),
                    "type": "template",
                })
                seen_files.add(file_url)

        template_instruction = ""
        if templates:
            template_list = "\n".join([f"- {t['title']}" for t in templates])
            template_instruction = (
                f"\nВАЖЛИВО: Знайдено офіційні шаблони документів:\n{template_list}\n"
                f"Обов'язково порадь користувачу завантажити відповідний шаблон."
            )

        prompt = f"""Ти — досвідчений український адвокат. Твоє завдання: надати точну, структуровану та корисну відповідь на питання користувача, базуючись ТІЛЬКИ на наданому контексті.

ПРАВИЛА ВІДПОВІДІ:
1. Використовуй офіційно-діловий, але зрозумілий стиль.
2. Обов'язково вказуй номери джерел [1], [2] після кожного твердження.
3. Якщо в контексті є суперечності, вкажи на це.
4. Якщо інформації недостатньо, чесно скажи про це.
{template_instruction}{court_instruction}

КОНТЕКСТ:
{context}

ПИТАННЯ КОРИСТУВАЧА: {data.question}
ВІДПОВІДЬ АДВОКАТА:"""

        response = gemini.models.generate_content(
            model=AI_MODEL,
            contents=types.Content(
                role="user",
                parts=[types.Part.from_text(text=prompt)],
            ),
            config=types.GenerateContentConfig(
                temperature=0.1,
                top_p=0.8,
            ),
        )

        references = []
        for i, d in enumerate(docs):
            meta = d.get("out_metadata") or {}
            content_snippet = d.get("out_content") or ""
            references.append({
                "num": i + 1,
                "source_title": meta.get("source", "Документ"),
                "category": meta.get("category", "Невідомо"),
                "law_url": meta.get("law_url", ""),
                "status": meta.get("status", "Чинний"),
                "is_template": meta.get("is_template", False),
                "passages": [content_snippet],
            })

        print(f"✅ Відповідь сформована. Знайдено шаблонів: {len(templates)}")
        return {"answer": response.text, "references": references, "templates": templates}

    except Exception as e:
        traceback.print_exc()
        return {
            "answer": f"На жаль, сталася технічна помилка: {str(e)}",
            "references": [],
            "templates": [],
        }


# ── Admin: RADA endpoints ──────────────────────────────────────────────────

@app.post("/admin/rada/trigger")
async def trigger_rada_now():
    with _scraping_lock:
        if _scraping_running:
            raise HTTPException(status_code=409, detail="Scraping already in progress")
    t = threading.Thread(target=_run_sync_task, daemon=True)
    t.start()
    return {"status": "started"}


@app.get("/admin/rada/logs")
async def get_rada_logs():
    history = []
    try:
        with httpx.Client() as client:
            r = client.get(
                f"{SUPABASE_URL}/rest/v1/sync_logs",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={"select": "*", "order": "started_at.desc", "limit": "20"},
                timeout=5.0,
            )
            if r.status_code == 200:
                history = r.json()
    except Exception as e:
        print(f"⚠️ Could not fetch logs: {e}")

    return {
        "running": _scraping_running,
        "live_logs": list(_scraping_logs),
        "history": history,
    }


class ScheduleBody(BaseModel):
    enabled: bool


async def _get_setting(key: str, default: bool = True) -> bool:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/app_settings?key=eq.{key}&select=value_bool",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                timeout=5.0,
            )
            if r.status_code == 200:
                data = r.json()
                if data:
                    return bool(data[0]["value_bool"])
        return default
    except Exception as e:
        print(f"⚠️ Помилка читання налаштування {key}: {e}")
        return default


@app.get("/admin/rada/schedule")
async def get_schedule():
    enabled = await _get_setting("schedule_enabled")
    return {"enabled": enabled}


@app.post("/admin/rada/schedule")
async def set_schedule(body: ScheduleBody):
    async with httpx.AsyncClient() as client:
        res = await client.patch(
            f"{SUPABASE_URL}/rest/v1/app_settings?key=eq.schedule_enabled",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "value_bool": body.enabled,
                "updated_at": datetime.datetime.now().isoformat(),
            },
            timeout=10.0,
        )
        res.raise_for_status()

    if body.enabled:
        _scheduler.resume_job(_schedule_job.id)
    else:
        _scheduler.pause_job(_schedule_job.id)

    return {"enabled": body.enabled}


@app.get("/admin/stats")
async def get_stats():
    doc_count = 0
    last_sync = None
    real_schedule_status = await _get_setting("schedule_enabled", default=True)

    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/documents",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Prefer": "count=exact",
                },
                params={"select": "id", "limit": "1"},
                timeout=5.0,
            )
            content_range = r.headers.get("content-range", "")
            if "/" in content_range:
                doc_count = int(content_range.split("/")[1])

            r_log = await client.get(
                f"{SUPABASE_URL}/rest/v1/sync_logs",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={"select": "*", "order": "started_at.desc", "limit": "1"},
                timeout=5.0,
            )
            if r_log.status_code == 200:
                rows = r_log.json()
                last_sync = rows[0] if rows else None
    except Exception as e:
        print(f"⚠️ Stats error: {e}")

    return {
        "doc_count": doc_count,
        "last_sync": last_sync,
        "schedule_enabled": real_schedule_status,
        "scraping_running": _scraping_running,
    }


@app.on_event("startup")
async def startup_event():
    try:
        async with httpx.AsyncClient() as client:
            await client.patch(
                f"{SUPABASE_URL}/rest/v1/sync_logs?status=eq.running",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "status": "error",
                    "finished_at": datetime.datetime.now().isoformat(),
                    "error_message": "Перервано: сервер перезапущено",
                },
                timeout=5.0,
            )
            print("🧹 Завислі sync_logs очищено")
    except Exception as e:
        print(f"⚠️ Не вдалося очистити sync_logs: {e}")

    enabled = await _get_setting("schedule_enabled")
    if not enabled:
        _scheduler.pause_job(_schedule_job.id)
        print("⏰ Розклад вимкнено згідно з налаштуваннями бази")


# ── Admin: Wiki state ─────────────────────────────────────────────────────

_wiki_lock = threading.Lock()
_wiki_running = False
_wiki_logs: deque = deque(maxlen=1000)


def _add_wiki_log(message: str, level: str = "info"):
    _wiki_logs.append({
        "ts": datetime.datetime.now().isoformat(),
        "message": message,
        "level": level,
    })
    print(f"[WIKI/{level.upper()}] {message}")


def _run_wiki_task():
    global _wiki_running
    if _wiki_running:
        return
    with _wiki_lock:
        _wiki_running = True
        _wiki_logs.clear()
    try:
        _add_wiki_log("📖 Початок синхронізації Wiki...")
        from wiki_scanner import run_wiki_sync
        run_wiki_sync(log_callback=_add_wiki_log)
        _add_wiki_log("✅ Wiki синхронізовано.", "success")
    except ImportError:
        _add_wiki_log("❌ wiki_scanner не знайдено.", "error")
    except Exception as e:
        _add_wiki_log(f"❌ Помилка: {e}", "error")
    finally:
        _wiki_running = False


@app.post("/admin/wiki/trigger")
async def trigger_wiki_now():
    with _wiki_lock:
        if _wiki_running:
            raise HTTPException(status_code=409, detail="Wiki scraping already in progress")
    t = threading.Thread(target=_run_wiki_task, daemon=True)
    t.start()
    return {"status": "started"}


@app.get("/admin/wiki/logs")
async def get_wiki_logs():
    return {
        "running": _wiki_running,
        "live_logs": list(_wiki_logs),
        "history": [],
    }


# ── Admin: Templates (data.gov.ua) state ─────────────────────────────────

_templates_lock = threading.Lock()
_templates_running = False
_templates_logs: deque = deque(maxlen=1000)

TEMPLATES_CSV_URL = os.environ.get(
    "TEMPLATES_CSV_URL",
    "https://data.gov.ua/dataset/02cfda55-8964-47bc-b1ea-0c072d6a8d45/resource/8604724a-7186-455b-8041-0160b73c2420/download",
)


def _add_templates_log(message: str, level: str = "info"):
    _templates_logs.append({
        "ts": datetime.datetime.now().isoformat(),
        "message": message,
        "level": level,
    })
    print(f"[TEMPLATES/{level.upper()}] {message}")


def _run_templates_task():
    global _templates_running
    if _templates_running:
        return
    with _templates_lock:
        _templates_running = True
        _templates_logs.clear()
    try:
        _add_templates_log("📄 Початок імпорту шаблонів з data.gov.ua...")
        from data_gov_scanner import sync_templates_from_opendata
        count = sync_templates_from_opendata(
            csv_url=TEMPLATES_CSV_URL,
            category="Офіційні шаблони",
            dataset_id="02cfda55-8964-47bc-b1ea-0c072d6a8d45",
            log_callback=_add_templates_log,
        )
        _add_templates_log(f"✅ Імпорт завершено. Додано: {count}.", "success")
    except ImportError:
        _add_templates_log("❌ data_gov_scanner не знайдено.", "error")
    except Exception as e:
        _add_templates_log(f"❌ Помилка: {e}", "error")
    finally:
        _templates_running = False


@app.post("/admin/templates/trigger")
async def trigger_templates_now():
    with _templates_lock:
        if _templates_running:
            raise HTTPException(status_code=409, detail="Templates import already in progress")
    t = threading.Thread(target=_run_templates_task, daemon=True)
    t.start()
    return {"status": "started"}


@app.get("/admin/templates/logs")
async def get_templates_logs():
    return {
        "running": _templates_running,
        "live_logs": list(_templates_logs),
        "history": [],
    }


# ── Admin: Supreme Court state ────────────────────────────────────────────

_supreme_lock = threading.Lock()
_supreme_running = False
_supreme_logs: deque = deque(maxlen=1000)


def _add_supreme_log(message: str, level: str = "info"):
    _supreme_logs.append({
        "ts": datetime.datetime.now().isoformat(),
        "message": message,
        "level": level,
    })
    print(f"[SUPREME/{level.upper()}] {message}")


def _run_supreme_task():
    global _supreme_running

    if _supreme_running:
        return

    with _supreme_lock:
        _supreme_running = True
        _supreme_logs.clear()

    try:
        _add_supreme_log("⚖️ Початок скрапінгу Верховного Суду...")
        from supreme_scanner import run_supreme_sync
        run_supreme_sync(log_callback=_add_supreme_log)
        _add_supreme_log("✅ Скрапінг Верховного Суду завершено.", "success")
    except ImportError:
        _add_supreme_log("❌ supreme_scanner не знайдено.", "error")
    except Exception as e:
        _add_supreme_log(f"❌ Помилка: {e}", "error")
    finally:
        _supreme_running = False


@app.post("/admin/supreme/trigger")
async def trigger_supreme_now():
    with _supreme_lock:
        if _supreme_running:
            raise HTTPException(status_code=409, detail="Supreme scraping already in progress")
    t = threading.Thread(target=_run_supreme_task, daemon=True)
    t.start()
    return {"status": "started"}


@app.get("/admin/supreme/logs")
async def get_supreme_logs():
    history = []
    try:
        with httpx.Client() as client:
            r = client.get(
                f"{SUPABASE_URL}/rest/v1/sync_logs",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={"select": "*", "order": "started_at.desc", "limit": "20"},
                timeout=5.0,
            )
            if r.status_code == 200:
                history = r.json()
    except Exception as e:
        print(f"⚠️ Could not fetch supreme logs: {e}")

    return {
        "running": _supreme_running,
        "live_logs": list(_supreme_logs),
        "history": history,
    }


@app.get("/admin/supreme/laws")
async def get_supreme_laws(search: str = "", page: int = 1, per_page: int = 25):
    try:
        offset = (page - 1) * per_page
        params: list[tuple[str, str]] = [
            ("select", "id,content,metadata"),
            ("metadata->>chunk_index", "eq.0"),
            ("metadata->>category", "eq.Судова практика"),
            ("order", "id.desc"),
            ("limit", str(per_page)),
            ("offset", str(offset)),
        ]
        if search:
            safe = search.replace("*", "").replace("(", "").replace(")", "")
            params.append(("or", f"(metadata->>source.ilike.*{safe}*,metadata->>law_id.ilike.*{safe}*)"))

        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/documents",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Prefer": "count=exact",
                },
                params=params,
                timeout=15.0,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Supabase error")

            laws = r.json()
            total = 0
            content_range = r.headers.get("content-range", "")
            if "/" in content_range:
                try:
                    total = int(content_range.split("/")[1])
                except ValueError:
                    total = len(laws)
            else:
                total = len(laws)

            return {
                "laws": laws,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": max(1, (total + per_page - 1) // per_page),
            }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Supreme laws list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/supreme/laws/text")
async def get_supreme_law_full_text(law_id: str):
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/documents",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={
                    "select": "content,metadata",
                    "metadata->>law_id": f"eq.{law_id}",
                    "order": "id.asc",
                    "limit": "500",
                },
                timeout=20.0,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Supabase error")

            chunks = r.json()
            if not chunks:
                raise HTTPException(status_code=404, detail="Document not found")

            chunks.sort(key=lambda x: int(x.get("metadata", {}).get("chunk_index", 0)))
            full_text = "\n\n".join(c.get("content", "") for c in chunks)
            meta = chunks[0].get("metadata", {})

            return {
                "law_id": law_id,
                "source": meta.get("source", ""),
                "status": meta.get("status", ""),
                "law_url": meta.get("law_url", ""),
                "category": meta.get("category", ""),
                "chunk_count": len(chunks),
                "full_text": full_text,
                "scraped_at": meta.get("scraped_at", ""),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: RADA Laws endpoints ─────────────────────────────────────────────

@app.get("/admin/laws")
async def get_laws(search: str = "", page: int = 1, per_page: int = 25):
    try:
        offset = (page - 1) * per_page
        params: list[tuple[str, str]] = [
            ("select", "id,content,metadata"),
            ("metadata->>chunk_index", "eq.0"),
            ("order", "id.desc"),
            ("limit", str(per_page)),
            ("offset", str(offset)),
        ]
        if search:
            safe = search.replace("*", "").replace("(", "").replace(")", "")
            params.append(("or", f"(metadata->>source.ilike.*{safe}*,metadata->>law_id.ilike.*{safe}*)"))

        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/documents",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Prefer": "count=exact",
                },
                params=params,
                timeout=15.0,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Supabase error")

            laws = r.json()
            total = 0
            content_range = r.headers.get("content-range", "")
            if "/" in content_range:
                try:
                    total = int(content_range.split("/")[1])
                except ValueError:
                    total = len(laws)
            else:
                total = len(laws)

            return {
                "laws": laws,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": max(1, (total + per_page - 1) // per_page),
            }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Laws list error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/laws/text")
async def get_law_full_text(law_id: str):
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/documents",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={
                    "select": "content,metadata",
                    "metadata->>law_id": f"eq.{law_id}",
                    "order": "id.asc",
                    "limit": "500",
                },
                timeout=20.0,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Supabase error")

            chunks = r.json()
            if not chunks:
                raise HTTPException(status_code=404, detail="Law not found")

            chunks.sort(key=lambda x: int(x.get("metadata", {}).get("chunk_index", 0)))
            full_text = "\n\n".join(c.get("content", "") for c in chunks)
            meta = chunks[0].get("metadata", {})

            return {
                "law_id": law_id,
                "source": meta.get("source", ""),
                "status": meta.get("status", "Невідомо"),
                "law_url": meta.get("law_url", ""),
                "category": meta.get("category", ""),
                "chunk_count": len(chunks),
                "full_text": full_text,
                "scraped_at": meta.get("scraped_at", ""),
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Admin: Knowledge Base (all sources) ───────────────────────────────────

@app.get("/admin/base/docs")
async def get_base_docs(
    search: str = "",
    source: str = "",   # "rada" | "supreme" | "wiki"
    category: str = "",
    page: int = 1,
    per_page: int = 25,
):
    """Усі документи з усіх джерел. Фільтрація і пагінація на сервері."""
    try:
        offset = (page - 1) * per_page

        params: list[tuple[str, str]] = [
            ("select", "id,content,metadata"),
            ("metadata->>chunk_index", "eq.0"),
            ("order", "id.desc"),
            ("limit", str(per_page)),
            ("offset", str(offset)),
        ]

        if category:
            params.append(("metadata->>category", f"eq.{category}"))

        if source == "supreme":
            params.append(("metadata->>law_id", "like.sc_%"))
        elif source == "wiki":
            params.append(("metadata->>law_id", "like.wiki_%"))
        elif source == "rada":
            params.append(("metadata->>law_id", "not.like.sc_%"))
            params.append(("metadata->>law_id", "not.like.wiki_%"))

        if search:
            safe = search.replace("*", "").replace("(", "").replace(")", "")
            params.append(("or", f"(metadata->>source.ilike.*{safe}*,metadata->>law_id.ilike.*{safe}*)"))

        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/documents",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Prefer": "count=exact",
                },
                params=params,
                timeout=15.0,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail=r.text[:200])

            docs = r.json()

            total = 0
            content_range = r.headers.get("content-range", "")
            if "/" in content_range:
                try:
                    total = int(content_range.split("/")[1])
                except ValueError:
                    total = len(docs)
            else:
                total = len(docs)

            return {
                "docs": docs,
                "total": total,
                "page": page,
                "per_page": per_page,
                "total_pages": max(1, (total + per_page - 1) // per_page),
            }
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Base docs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
