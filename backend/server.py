import os
import re
import sys
import traceback
import asyncio
import httpx
import threading
import datetime
from collections import deque
from typing import Optional
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
import vertexai
from vertexai.language_models import TextEmbeddingModel
from auth_router import router as auth_router, get_optional_user, check_and_increment_limit, _extract_ip, _upsert_profile, _get_profile, _sb_headers
import settings_cache

load_dotenv()

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ── З .env беремо ТІЛЬКИ Supabase підключення ────────────────────────────────
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

# Завантажуємо всі налаштування (SA JSON, моделі, промпт) з Supabase при старті
settings_cache.load()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(auth_router)


def _get_genai_client() -> genai.Client:
    """
    Повертає google.genai.Client через Vertex AI backend
    з service account credentials зі settings_cache.
    """
    creds   = settings_cache.get_credentials()
    project = settings_cache.get_vertex_project()
    location = settings_cache.get_vertex_location()
    if not creds or not project:
        raise ValueError(
            "Service Account JSON не налаштовано. "
            "Завантажте JSON в адмінці: AI Налаштування → Service Account."
        )
    print(f"DEBUG: Використовуємо проект {project} у локації {location}")
    return genai.Client(
        vertexai=True,
        project=project,
        location=location,
        credentials=creds,
    )


def _init_vertexai():
    """Ініціалізує vertexai SDK (потрібно для TextEmbeddingModel)."""
    creds    = settings_cache.get_credentials()
    project  = settings_cache.get_vertex_project()
    location = settings_cache.get_vertex_location()
    if not creds or not project:
        raise ValueError(
            "Service Account JSON не налаштовано. "
            "Завантажте JSON в адмінці: AI Налаштування → Service Account."
        )
    vertexai.init(project=project, location=location, credentials=creds)


def get_embedding(text: str, model_name: str | None = None) -> list[float]:
    """Векторизація тексту через Vertex AI TextEmbeddingModel."""
    _init_vertexai()
    model_id = model_name or settings_cache.get("embedding_model", "text-embedding-004")
    model = TextEmbeddingModel.from_pretrained(model_id)
    embeddings = model.get_embeddings([text])
    return embeddings[0].values

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
    threshold = settings_cache.get_float("match_threshold_templates", 0.3)
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
                    "match_threshold": threshold,
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


def search_supabase(query_vector: list, top_k: int = 10, filter_domains: list | None = None, match_threshold: float = 0.4) -> list:
    """
    Vector search in documents table.
    filter_domains: list of domain strings (e.g. ['zakon.rada.gov.ua', 'ccu.gov.ua'])
                    None = no filter, return all sources.
    """
    body: dict = {
        "query_embedding": query_vector,
        "match_threshold": match_threshold,
        "match_count": top_k,
        "filter_domains": filter_domains or [],
    }

    try:
        with httpx.Client() as client:
            response = client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/match_documents",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=10.0,
            )
            if response.status_code != 200:
                print(f"❌ Supabase search error: {response.text}")
                return []
            return response.json()
    except Exception as e:
        print(f"❌ Connection error: {str(e)}")
        return []


_SOURCE_FEATURE_MAP = {
    "source_rada":     "zakon.rada.gov.ua",
    "source_legalaid": "legalaid.gov.ua",
    "source_ccu":      "ccu.gov.ua",
    "source_supreme":  "supreme.court.gov.ua",
}


def _get_enabled_features(plan_id: str) -> set:
    """
    Fetch all enabled feature keys for a subscription plan.
    Returns empty set on error (safe default: no premium features).
    """
    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.get(
                f"{SUPABASE_URL}/rest/v1/plan_features",
                params={
                    "plan_id": f"eq.{plan_id}",
                    "enabled": "eq.true",
                    "select": "feature_key",
                },
                headers=_sb_headers(service=True),
            )
            if r.status_code == 200:
                return {row["feature_key"] for row in r.json()}
    except Exception:
        pass
    return set()


def _domains_from_features(features: set) -> list | None:
    """
    Convert enabled feature set to source domain allowlist.
    Returns None if no source features enabled (= allow all, shouldn't happen).
    """
    domains = [v for k, v in _SOURCE_FEATURE_MAP.items() if k in features]
    return domains if domains else None


def _build_response_rules(features: set) -> str:
    """
    Build Gemini prompt rules section based on the plan's enabled response features.
    """
    rules = [
        "1. Стиль офіційно-діловий.",
        "2. Вказуй джерела [1], [2] після кожного твердження.",
    ]
    n = 3

    if "response_detailed" in features:
        rules.append(f"{n}. Надай повний розгорнутий аналіз — не обмежуйся коротким summary.")
        n += 1
    else:
        rules.append(f"{n}. Відповідь стисла та конкретна (3–5 речень).")
        n += 1

    if "response_steps" in features:
        rules.append(f"{n}. Обов'язково додай розділ «Що робити далі» з конкретними кроками.")
        n += 1

    if "response_scenarios" in features:
        rules.append(f"{n}. Розглянь альтернативні сценарії розвитку ситуації (мінімум 2 варіанти).")
        n += 1

    if "response_vs_position" in features:
        rules.append(f"{n}. Обов'язково посилайся на конкретні правові позиції Верховного суду.")
        n += 1

    return "\n".join(rules)


# _get_all_settings замінено на settings_cache.get_all() — дивись settings_cache.py

async def _get_plan_limits(plan_id: str) -> tuple[int, int]:
    """Returns (docs_limit, templates_limit) for a specific plan. Fallbacks to Free plan limits."""
    docs_limit, tpl_limit = 5, 1 
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/subscription_plans?id=eq.{plan_id}&select=max_docs_retrieved,max_templates_retrieved",
                headers=_sb_headers(service=True),
                timeout=5.0,
            )
            if r.status_code == 200 and r.json():
                data = r.json()[0]
                docs_limit = data.get("max_docs_retrieved", docs_limit)
                tpl_limit = data.get("max_templates_retrieved", tpl_limit)
    except Exception:
        pass
    return docs_limit, tpl_limit

# @app.post("/ask")
# async def ask_lawyer(
#     data: Query,
#     request: Request,
#     user: Optional[dict] = Depends(get_optional_user),
# ):
#     print(f"🔍 ЗАПИТ: {data.question}")

#     # ── Auth + limit check ───────────────────────────────────────────────────
#     if user:
#         user_id: str = user["id"]
#         check_and_increment_limit(user_id)

#         # Record IP / UA on each request (best-effort, non-blocking)
#         ip = _extract_ip(request)
#         ua = request.headers.get("user-agent", "")
#         if ip:
#             _upsert_profile({
#                 "id": user_id,
#                 "email": user.get("email", ""),
#                 "last_ip": ip,
#                 "user_agent": ua,
#                 "updated_at": datetime.datetime.utcnow().isoformat(),
#             })
#     else:
#         # No token — still allow for now (frontend will block via middleware)
#         # but you can change this to raise 401 if you want strict enforcement
#         pass

#     try:
#         court_instruction = try_fetch_court_case(data.question)

#         query_vector = await asyncio.wait_for(
#             asyncio.to_thread(get_embedding, data.question),
#             timeout=90.0,
#         )

#         # Паралельний пошук: закони + шаблони
#         docs, template_hits = await asyncio.gather(
#             asyncio.to_thread(search_supabase, query_vector, 10),
#             asyncio.to_thread(search_templates, query_vector, 3),
#         )

#         if not docs and not template_hits:
#             return {
#                 "answer": "Вибачте, у моїй базі знань поки немає інформації за цим запитом. Спробуйте уточнити питання.",
#                 "references": [],
#                 "templates": [],
#             }

#         context_parts = []
#         seen_files = set()

#         for i, d in enumerate(docs):
#             content = d.get("out_content", "")
#             meta = d.get("out_metadata", {})
#             source_title = meta.get("source", "Документ")
#             category = meta.get("category", "Загальне")

#             context_parts.append(
#                 f"--- Джерело [{i+1}]: {source_title} ({category}) ---\n"
#                 f"Текст: {content}"
#             )

#             # Шаблони що прийшли з таблиці documents (wiki)
#             file_url = meta.get("file_url")
#             if file_url and file_url not in seen_files:
#                 seen_files.add(file_url)

#         context = "\n\n".join(context_parts)

#         # Шаблони з document_templates — головне джерело файлів
#         templates = []
#         for t in template_hits:
#             file_url = t.get("file_url", "")
#             if file_url and file_url not in seen_files:
#                 templates.append({
#                     "title": t.get("title", "Шаблон"),
#                     "url": file_url,
#                     "category": t.get("category", ""),
#                     "type": "template",
#                 })
#                 seen_files.add(file_url)

#         template_instruction = ""
#         if templates:
#             template_list = "\n".join([f"- {t['title']}" for t in templates])
#             template_instruction = (
#                 f"\nВАЖЛИВО: Знайдено офіційні шаблони документів:\n{template_list}\n"
#                 f"Обов'язково порадь користувачу завантажити відповідний шаблон."
#             )

#         prompt = f"""Ти — досвідчений український адвокат. Твоє завдання: надати точну, структуровану та корисну відповідь на питання користувача, базуючись ТІЛЬКИ на наданому контексті.

# ПРАВИЛА ВІДПОВІДІ:
# 1. Використовуй офіційно-діловий, але зрозумілий стиль.
# 2. Обов'язково вказуй номери джерел [1], [2] після кожного твердження.
# 3. Якщо в контексті є суперечності, вкажи на це.
# 4. Якщо інформації недостатньо, чесно скажи про це.
# {template_instruction}{court_instruction}

# КОНТЕКСТ:
# {context}

# ПИТАННЯ КОРИСТУВАЧА: {data.question}
# ВІДПОВІДЬ АДВОКАТА:"""

#         response = await asyncio.wait_for(
#             asyncio.to_thread(
#                 gemini.models.generate_content,
#                 model=AI_MODEL,
#                 contents=types.Content(
#                     role="user",
#                     parts=[types.Part.from_text(text=prompt)],
#                 ),
#                 config=types.GenerateContentConfig(
#                     temperature=0.1,
#                     top_p=0.8,
#                 ),
#             ),
#             timeout=90.0,
#         )

#         references = []
#         for i, d in enumerate(docs):
#             meta = d.get("out_metadata") or {}
#             content_snippet = d.get("out_content") or ""
#             references.append({
#                 "num": i + 1,
#                 "source_title": meta.get("source", "Документ"),
#                 "category": meta.get("category", "Невідомо"),
#                 "law_url": meta.get("law_url", ""),
#                 "status": meta.get("status", "Чинний"),
#                 "is_template": meta.get("is_template", False),
#                 "passages": [content_snippet],
#             })

#         print(f"✅ Відповідь сформована. Знайдено шаблонів: {len(templates)}")
#         return {"answer": response.text, "references": references, "templates": templates}

#     except asyncio.TimeoutError:
#         friendly_answer = "Запит зайняв занадто багато часу. Спробуйте ще раз."
#         return {"answer": friendly_answer, "references": [], "templates": []}
#     except Exception as e:
#         traceback.print_exc()
#         error_msg = str(e)

#         if "503" in error_msg or "high demand" in error_msg.lower():
#             friendly_answer = "Вибачте, зараз занадто багато запитів до нейромережі. Будь ласка, спробуйте ще раз через 1-2 хвилини."
#         else:
#             friendly_answer = f"На жаль, сталася технічна помилка. Спробуйте пізніше або зверніться в підтримку."
            
#         return {
#             "answer": friendly_answer,
#             "references": [],
#             "templates": [],
#             "error_detail": error_msg # залишаємо для логів
#         }




@app.post("/ask")
async def ask_lawyer(
    data: Query,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user),
):
    print(f"🔍 ЗАПИТ: {data.question}")

    # ── 1. Авторизація та ліміти ───────────────────────────────────────────
    filter_domains: list | None = None
    enabled_features: set = set()
    plan_id = "free"
    profile: dict | None = None

    if user:
        user_id: str = user["id"]
        await asyncio.to_thread(check_and_increment_limit, user_id)

        ip = _extract_ip(request)
        ua = request.headers.get("user-agent", "")
        if ip:
            await asyncio.to_thread(_upsert_profile, {
                "id": user_id,
                "email": user.get("email", ""),
                "last_ip": ip,
                "user_agent": ua,
                "updated_at": datetime.datetime.utcnow().isoformat(),
            })

        profile = await asyncio.to_thread(_get_profile, user_id)
        if profile:
            plan_id = profile.get("subscription_tier", plan_id)
            enabled_features = await asyncio.to_thread(_get_enabled_features, plan_id)
            filter_domains = _domains_from_features(enabled_features)

    ai_model    = settings_cache.get("ai_model",        "gemini-2.0-flash-lite")
    emb_model   = settings_cache.get("embedding_model", "text-embedding-004")
    sys_prompt  = settings_cache.get("system_prompt",   "Ти — досвідчений український адвокат.")
    temperature = settings_cache.get_float("temperature", 0.1)
    top_p       = settings_cache.get_float("top_p", 0.8)
    doc_limit, tpl_limit = await _get_plan_limits(plan_id)

    try:
        # ── 2. Пошук контексту ──────────────────────────────────────────────
        court_instruction = try_fetch_court_case(data.question)

        query_vector = await asyncio.wait_for(
            asyncio.to_thread(get_embedding, data.question, emb_model),
            timeout=60.0,
        )

        docs, template_hits = await asyncio.gather(
            asyncio.to_thread(search_supabase, query_vector, doc_limit, filter_domains),
            asyncio.to_thread(search_templates, query_vector, tpl_limit),
        )

        if not docs and not template_hits:
            return {
                "answer": "Вибачте, інформації не знайдено.",
                "references": [],
                "templates": [],
            }

        context_parts = []
        seen_files = set()
        for i, d in enumerate(docs):
            content = d.get("out_content", "")
            meta = d.get("out_metadata", {})
            context_parts.append(f"--- Джерело [{i+1}]: {meta.get('source')} ---\nТекст: {content}")

        context = "\n\n".join(context_parts)

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

        if templates:
            template_list = "\n".join([f"- {t['title']}" for t in templates])
            template_instruction = (
                f"\nВАЖЛИВО: Знайдено офіційні шаблони документів:\n{template_list}\n"
                f"Обов'язково порадь користувачу завантажити відповідний шаблон."
            )
        else:
            template_instruction = ""

        # ── 3. Формування промпту ───────────────────────────────────────────

        # Контекст користувача з онбордингу
        user_ctx_parts = []
        if profile:
            role    = profile.get("role") or ""
            sub     = profile.get("sub_role") or ""
            segs    = profile.get("segment") or []
            if isinstance(segs, list) and segs:
                user_ctx_parts.append(f"Сфери інтересів: {', '.join(segs)}")
            if role:
                user_ctx_parts.append(f"Роль: {role}")
            if sub:
                if isinstance(sub, list):
                    user_ctx_parts.append(f"Спеціалізація: {', '.join(sub)}")
                else:
                    user_ctx_parts.append(f"Спеціалізація: {sub}")

        user_context_block = (
            "ПРОФІЛЬ КОРИСТУВАЧА:\n" + "\n".join(user_ctx_parts) + "\n"
            "Адаптуй рівень деталізації та термінологію під цього користувача.\n"
        ) if user_ctx_parts else ""

        response_rules = _build_response_rules(enabled_features)

        prompt = f"""{sys_prompt}

{user_context_block}
ПРАВИЛА ВІДПОВІДІ (ОБОВ'ЯЗКОВО):
{response_rules}
{template_instruction}{court_instruction}

КРИТИЧНО ВАЖЛИВО — ЗАБОРОНЕНО:
- Вигадувати, припускати або доповнювати інформацію яка НЕ міститься в КОНТЕКСТІ нижче
- Посилатися на закони, статті або рішення яких немає в КОНТЕКСТІ
- Відповідати «за загальними знаннями» якщо їх немає в КОНТЕКСТІ
- Якщо контексту недостатньо — прямо скажи: «У доступній базі знань немає достатньої інформації для повної відповіді»

КОНТЕКСТ (єдине джерело інформації):
{context}

ПИТАННЯ: {data.question}
ВІДПОВІДЬ АДВОКАТА:"""

        # ── Генерація через Vertex AI (google.genai з vertexai=True) ─────────
        def _generate():
            client = _get_genai_client()
            return client.models.generate_content(
                model=ai_model,
                contents=types.Content(role="user", parts=[types.Part.from_text(text=prompt)]),
                config=types.GenerateContentConfig(temperature=temperature, top_p=top_p),
            )
        sdk_response = await asyncio.to_thread(_generate)
        answer_text = sdk_response.text or "Вибачте, ШІ не зміг сформувати відповідь."

        # ── 4. Формування references ────────────────────────────────────────
        references = []
        for i, d in enumerate(docs):
            meta = d.get("out_metadata") or {}
            references.append({
                "num": i + 1,
                "source_title": meta.get("source", "Документ"),
                "category": meta.get("category", "Невідомо"),
                "law_url": meta.get("law_url", ""),
                "status": meta.get("status", "Чинний"),
                "passages": [d.get("out_content", "")],
            })

        print(f"✅ Відповідь сформована. Шаблонів: {len(templates)}")
        return {"answer": answer_text, "references": references, "templates": templates}

    except asyncio.TimeoutError:
        return {"answer": "Сервер занадто довго аналізував дані.", "references": [], "templates": []}
    except Exception as e:
        traceback.print_exc()
        error_msg = str(e).lower()
        if "handshake" in error_msg or "ssl" in error_msg:
            friendly_answer = "Проблема захищеного з'єднання. Спробуйте ще раз."
        else:
            friendly_answer = "Сталася технічна помилка. Спробуйте пізніше."
        return {"answer": friendly_answer, "references": [], "templates": [], "error_detail": str(e)}
# ── Admin: Settings cache refresh ──────────────────────────────────────────

@app.post("/admin/settings/refresh")
async def refresh_settings():
    """Перезавантажує кеш налаштувань з Supabase. Викликається адмінкою після збереження."""
    await settings_cache.refresh()
    return {"ok": True, "settings": list(settings_cache.get_all().keys())}


# ── Admin: RADA endpoints

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
            if r.status_code not in (200, 206):
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
