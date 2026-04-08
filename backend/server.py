"""
server.py — FastAPI бекенд для URAI (Lawyer AI Assistant).

Запуск:  cd /home/devops/app/backend && uvicorn server:app --host 0.0.0.0 --port 8000

Endpoints:
  GET  /admin/stats
  POST /admin/rada/trigger     — запустити з початку
  POST /admin/rada/pause       — пауза (допрацює поточний документ, збереже прогрес)
  POST /admin/rada/resume      — відновити з місця зупинки
  GET  /admin/rada/logs        — live-логи + history
  GET  /admin/rada/schedule    — отримати стан розкладу
  POST /admin/rada/schedule    — увімк/вимк автосинхронізацію
  POST /admin/supreme/trigger
  GET  /admin/supreme/logs
  POST /admin/wiki/trigger
  GET  /admin/wiki/logs
  POST /admin/templates/trigger
  GET  /admin/templates/logs
"""

import os
import re
import json
import uuid
import time
import threading
from datetime import datetime, timezone
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv

load_dotenv()
import settings_cache  # noqa: E402 — треба після load_dotenv

# ── Шлях до файлу збереженого стану (resume) ─────────────────────────────────
BASE_DIR = Path(__file__).parent
SYNC_STATE_FILE = BASE_DIR / "sync_state.json"

# ── Supabase ───────────────────────────────────────────────────────────────────
_SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
_SB_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)

# ── In-memory стан по кожному джерелу ─────────────────────────────────────────
_SOURCES = ("rada", "supreme", "wiki", "templates")
_sync: dict[str, dict] = {
    src: {
        "running": False,
        "pause_requested": False,
        "live_logs": [],   # [{ts, message, level}] — кільце MAX_LIVE_LOGS записів
        "session_id": None,
    }
    for src in _SOURCES
}
_lock = threading.Lock()
MAX_LIVE_LOGS = 500


# ══════════════════════════════════════════════════════════════════════════════
# Supabase helpers
# ══════════════════════════════════════════════════════════════════════════════

def _sb_hdrs(prefer_minimal: bool = False) -> dict:
    h = {
        "apikey": _SB_KEY,
        "Authorization": f"Bearer {_SB_KEY}",
        "Content-Type": "application/json",
    }
    if prefer_minimal:
        h["Prefer"] = "return=minimal"
    return h


def _sb_insert_log(source: str, session_id: str) -> None:
    """Записує початок сесії у sync_logs."""
    if not _SB_URL:
        return
    try:
        with httpx.Client(timeout=10) as c:
            c.post(
                f"{_SB_URL}/rest/v1/sync_logs",
                headers=_sb_hdrs(prefer_minimal=True),
                json={
                    "session_id": session_id,
                    "source": source,
                    "status": "running",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                },
            )
    except Exception as e:
        print(f"⚠️ sync_log insert: {e}")


def _sb_update_log(session_id: str, **kw) -> None:
    """Оновлює рядок sync_logs по session_id."""
    if not _SB_URL:
        return
    try:
        with httpx.Client(timeout=10) as c:
            c.patch(
                f"{_SB_URL}/rest/v1/sync_logs?session_id=eq.{session_id}",
                headers=_sb_hdrs(prefer_minimal=True),
                json=kw,
            )
    except Exception as e:
        print(f"⚠️ sync_log update: {e}")


def _sb_get_logs(source: str, limit: int = 20) -> list:
    """Повертає останні N записів history із sync_logs."""
    if not _SB_URL:
        return []
    try:
        with httpx.Client(timeout=10) as c:
            r = c.get(
                f"{_SB_URL}/rest/v1/sync_logs",
                headers=_sb_hdrs(),
                params={
                    "source": f"eq.{source}",
                    "order": "started_at.desc",
                    "limit": str(limit),
                },
            )
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        print(f"⚠️ sync_log get: {e}")
    return []


def _sb_update_schedule(enabled: bool) -> None:
    """Зберігає schedule_enabled у app_settings."""
    if not _SB_URL:
        return
    try:
        with httpx.Client(timeout=10) as c:
            c.patch(
                f"{_SB_URL}/rest/v1/app_settings?key=eq.schedule_enabled",
                headers=_sb_hdrs(prefer_minimal=True),
                json={"value_bool": enabled},
            )
    except Exception as e:
        print(f"⚠️ schedule update: {e}")


def _qdrant_doc_count() -> int:
    """Кількість векторів у Qdrant."""
    try:
        from qdrant_storage import get_client, COLLECTION_NAME
        info = get_client().get_collection(COLLECTION_NAME)
        return info.points_count or 0
    except Exception as e:
        print(f"⚠️ doc_count: {e}")
        return 0


# ══════════════════════════════════════════════════════════════════════════════
# Логування
# ══════════════════════════════════════════════════════════════════════════════

def _log(src: str, msg: str, level: str = "info") -> None:
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "message": msg,
        "level": level,
    }
    with _lock:
        buf = _sync[src]["live_logs"]
        buf.append(entry)
        if len(buf) > MAX_LIVE_LOGS:
            _sync[src]["live_logs"] = buf[-MAX_LIVE_LOGS:]
    print(f"[{src.upper()}][{level.upper()}] {msg}")


# ══════════════════════════════════════════════════════════════════════════════
# Збережений стан (для resume після паузи або перезапуску сервера)
# ══════════════════════════════════════════════════════════════════════════════

def _save_state(source: str, all_laws: list, next_idx: int, session_id: str) -> None:
    data = {
        "source": source,
        "all_laws": all_laws,
        "next_index": next_idx,
        "session_id": session_id,
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    SYNC_STATE_FILE.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _load_state() -> dict | None:
    if SYNC_STATE_FILE.exists():
        try:
            return json.loads(SYNC_STATE_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"⚠️ load_state: {e}")
    return None


def _clear_state() -> None:
    if SYNC_STATE_FILE.exists():
        SYNC_STATE_FILE.unlink()
        print("🗑️  sync_state.json cleared")


# ══════════════════════════════════════════════════════════════════════════════
# Фонові задачі скрапінгу
# ══════════════════════════════════════════════════════════════════════════════

def _do_rada(
    session_id: str,
    start_index: int = 0,
    all_laws_cached: list | None = None,
    section_codes: list[str] | None = None,
) -> None:
    """
    Головна функція синхронізації Ради.
    Підтримує: старт з нуля, resume з індексу, пауза після поточного документа.
    section_codes — вибрані розділи (None = всі дефолтні SECTIONS).
    """
    src = "rada"
    log = lambda m, lv="info": _log(src, m, lv)

    log("=" * 50)
    log(f"🚀 RADA SYNC (сесія {session_id[:8]}...)")
    if start_index > 0:
        log(f"▶️  Відновлення з індексу {start_index}")
    if section_codes:
        log(f"📂 Вибрані розділи: {', '.join(section_codes)}")
    log("=" * 50)

    _sb_insert_log(src, session_id)
    processed = 0

    try:
        from qdrant_storage import get_existing_laws_meta, delete_law_chunks, upload_to_qdrant
        from rada_scanner import get_all_legal_ids, get_law_text, get_law_metadata, BASE
        from langchain_text_splitters import MarkdownTextSplitter
        from rada_to_supabase import embeddings

        splitter = MarkdownTextSplitter(chunk_size=1500, chunk_overlap=200)

        # 1. Отримуємо список законів (або з кешу при resume)
        if all_laws_cached is not None:
            all_laws = all_laws_cached
            log(f"📋 Список завантажено з кешу: {len(all_laws)} законів")
        else:
            log("📡 Сканування розділів Ради...")
            all_laws = get_all_legal_ids(section_codes=section_codes)
            log(f"📦 Знайдено: {len(all_laws)} унікальних законів")

        # 2. Метадані існуючих (завжди свіжі)
        log("🔍 Завантаження метаданих Qdrant...")
        existing_meta = get_existing_laws_meta()
        log(f"📊 В базі вже: {len(existing_meta)} законів")

        total = len(all_laws)

        for i in range(start_index, total):

            # ── Перевірка запиту на паузу ─────────────────────────────────
            with _lock:
                pause = _sync[src]["pause_requested"]
            if pause:
                log(f"⏸️  Зберігаємо прогрес ({i}/{total}) та зупиняємось...", "warning")
                _save_state(src, all_laws, i, session_id)
                _sb_update_log(
                    session_id,
                    status="paused",
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    laws_processed=processed,
                    error_message=f"Призупинено на законі {i}/{total}",
                )
                log(f"⏸️  Призупинено. Прогрес збережено. Відновіть будь-коли.", "warning")
                with _lock:
                    _sync[src]["running"] = False
                    _sync[src]["pause_requested"] = False
                return

            law = all_laws[i]
            law_id = law["id"]
            law_title = law["title"]
            category = law["category"]
            law_url = f"{BASE}/laws/show/{law_id}"

            # ── Логіка дедуплікації / оновлення ───────────────────────────
            should_download = True
            if law_id in existing_meta:
                try:
                    last_str = existing_meta[law_id].replace("Z", "+00:00")
                    last = datetime.fromisoformat(last_str)
                    now = datetime.now(timezone.utc) if last.tzinfo else datetime.now()
                    days = (now - last).days
                    if days < 7:
                        should_download = False
                    else:
                        log(f"🔄 Оновлення: {law_id} (вік: {days} дн.)")
                        delete_law_chunks(law_id)
                except Exception:
                    pass  # при помилці парсингу дати — скачуємо знову

            if not should_download:
                # Зберігаємо прогрес навіть для пропущених
                _save_state(src, all_laws, i + 1, session_id)
                continue

            log(f"[{i + 1}/{total}] {law_title[:65]}")

            text = get_law_text(law_id)
            if not text:
                log(f"  ⚠️ Порожній текст — пропускаємо", "warning")
                _save_state(src, all_laws, i + 1, session_id)
                continue

            law_meta = get_law_metadata(law_id)
            chunks = splitter.split_text(text)
            log(f"  ✂️ {len(chunks)} чанків | Статус: {law_meta['status']}")

            scraped_at = datetime.now(timezone.utc).isoformat()
            for j, chunk in enumerate(chunks):
                try:
                    vector = embeddings.embed_query(chunk)
                    upload_to_qdrant(
                        chunk,
                        {
                            "source": law_title,
                            "law_id": law_id,
                            "category": category,
                            "status": law_meta["status"],
                            "law_url": law_url,
                            "source_domain": "zakon.rada.gov.ua",
                            "scraped_at": scraped_at,
                            "chunk_index": j,
                        },
                        vector,
                        session_id=session_id,
                    )
                    time.sleep(0.5)
                except Exception as e:
                    log(f"  ❌ Чанк {j}: {e}", "error")
                    time.sleep(2)

            processed += 1
            log(f"  ✅ Готово! (всього оброблено: {processed})", "success")

            # Зберігаємо прогрес після кожного закону
            _save_state(src, all_laws, i + 1, session_id)
            time.sleep(0.5)

        # ── Успішне завершення ─────────────────────────────────────────────
        _clear_state()
        _sb_update_log(
            session_id,
            status="success",
            finished_at=datetime.now(timezone.utc).isoformat(),
            laws_processed=processed,
        )
        log(f"✅ Синхронізацію завершено! Оброблено: {processed} законів.", "success")

    except Exception as e:
        log(f"❌ Критична помилка: {e}", "error")
        _sb_update_log(
            session_id,
            status="error",
            finished_at=datetime.now(timezone.utc).isoformat(),
            laws_processed=processed,
            error_message=str(e),
        )
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_supreme(session_id: str) -> None:
    src = "supreme"
    log = lambda m, lv="info": _log(src, m, lv)
    log("⚖️ Синхронізація Верховного Суду...")
    _sb_insert_log(src, session_id)
    try:
        from supreme_scanner import run_supreme_sync
        run_supreme_sync(session_id=session_id, log_callback=lambda m: log(m))
        _sb_update_log(
            session_id,
            status="success",
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
        log("✅ Верховний Суд завершено.", "success")
    except Exception as e:
        log(f"❌ {e}", "error")
        _sb_update_log(
            session_id,
            status="error",
            finished_at=datetime.now(timezone.utc).isoformat(),
            error_message=str(e),
        )
    finally:
        with _lock:
            _sync[src]["running"] = False


def _do_wiki(session_id: str) -> None:
    src = "wiki"
    _log(src, "📚 Wiki — синхронізація поки не реалізована (заглушка)", "warning")
    _sb_insert_log(src, session_id)
    time.sleep(1)
    _sb_update_log(
        session_id,
        status="success",
        finished_at=datetime.now(timezone.utc).isoformat(),
        laws_processed=0,
    )
    with _lock:
        _sync[src]["running"] = False


def _do_templates(session_id: str) -> None:
    src = "templates"
    _log(src, "📋 Шаблони — синхронізація поки не реалізована (заглушка)", "warning")
    _sb_insert_log(src, session_id)
    time.sleep(1)
    _sb_update_log(
        session_id,
        status="success",
        finished_at=datetime.now(timezone.utc).isoformat(),
        laws_processed=0,
    )
    with _lock:
        _sync[src]["running"] = False


def _start_sync(src: str, fn, session_id: str, **kwargs) -> None:
    """Запускає фонову задачу. Кидає ValueError якщо вже виконується."""
    with _lock:
        if _sync[src]["running"]:
            raise ValueError(f"{src} вже виконується")
        _sync[src].update({
            "running": True,
            "pause_requested": False,
            "live_logs": [],
            "session_id": session_id,
        })
    threading.Thread(
        target=fn,
        kwargs={"session_id": session_id, **kwargs},
        daemon=True,
    ).start()


# ══════════════════════════════════════════════════════════════════════════════
# APScheduler — автоматичний щоденний запуск
# ══════════════════════════════════════════════════════════════════════════════

_scheduler = BackgroundScheduler(timezone="UTC")


def _scheduled_sync() -> None:
    """Викликається щодня о 01:00 UTC. Перевіряє прапор і запускає синхронізацію."""
    if not settings_cache.get_bool("schedule_enabled", False):
        print("⏰ [scheduler] schedule_enabled=false — пропускаємо")
        return
    with _lock:
        if _sync["rada"]["running"]:
            print("⏰ [scheduler] Рада вже виконується — пропускаємо")
            return
    session_id = str(uuid.uuid4())
    print(f"⏰ [scheduler] Автозапуск: {session_id[:8]}")
    try:
        _start_sync("rada", _do_rada, session_id)
    except Exception as e:
        print(f"⏰ [scheduler] Помилка запуску: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# FastAPI app
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings_cache.load()

    # Перевіряємо наявність збереженого стану
    state = _load_state()
    if state and state.get("source") == "rada":
        idx = state.get("next_index", 0)
        total = len(state.get("all_laws", []))
        print(f"⚠️  Знайдено збережений стан: Рада, прогрес {idx}/{total}")

    _scheduler.add_job(_scheduled_sync, "cron", hour=1, minute=0, id="rada_daily")
    _scheduler.start()
    print("✅ URAI backend ready.")
    yield
    _scheduler.shutdown(wait=False)


app = FastAPI(title="URAI Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScheduleBody(BaseModel):
    enabled: bool


# ── /admin/stats ───────────────────────────────────────────────────────────────

@app.get("/admin/stats")
async def get_stats():
    with _lock:
        running = _sync["rada"]["running"]

    state = _load_state()
    can_resume = (
        not running
        and state is not None
        and state.get("source") == "rada"
    )

    history = _sb_get_logs("rada", limit=1)
    return {
        "doc_count": _qdrant_doc_count(),
        "last_sync": history[0] if history else None,
        "schedule_enabled": settings_cache.get_bool("schedule_enabled", False),
        "scraping_running": running,
        "can_resume": can_resume,
        "resume_progress": {
            "next_index": state["next_index"],
            "total": len(state["all_laws"]),
        } if can_resume else None,
    }


# ── /admin/rada/* ──────────────────────────────────────────────────────────────

class RadaTriggerBody(BaseModel):
    section_codes: list[str] | None = None  # None = all default sections


@app.get("/admin/rada/themes")
async def get_rada_themes():
    """Повертає список всіх тем Ради для вибору в UI."""
    from rada_scanner import ALL_THEMES
    return [{"code": code, "label": label} for code, label in ALL_THEMES]


@app.post("/admin/rada/trigger")
async def trigger_rada(body: RadaTriggerBody = RadaTriggerBody()):
    """Запуск синхронізації Ради з початку (видаляє збережений стан).
    section_codes: список кодів розділів або null = всі дефолтні розділи."""
    session_id = str(uuid.uuid4())
    _clear_state()
    try:
        _start_sync("rada", _do_rada, session_id, section_codes=body.section_codes)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/rada/pause")
async def pause_rada():
    """Запрошує паузу. Поточний документ буде допрацьовано, потім зупинка."""
    with _lock:
        if not _sync["rada"]["running"]:
            raise HTTPException(400, "Синхронізація не виконується")
        _sync["rada"]["pause_requested"] = True
    return {"ok": True, "message": "Пауза запрошена — поточний документ буде завершено"}


@app.post("/admin/rada/resume")
async def resume_rada():
    """Відновлення з місця зупинки."""
    state = _load_state()
    if not state or state.get("source") != "rada":
        raise HTTPException(404, "Немає збереженого стану для відновлення")

    all_laws = state["all_laws"]
    next_idx = state["next_index"]
    session_id = state.get("session_id") or str(uuid.uuid4())

    try:
        _start_sync("rada", _do_rada, session_id,
                    start_index=next_idx, all_laws_cached=all_laws)
    except ValueError as e:
        raise HTTPException(409, str(e))

    return {
        "ok": True,
        "session_id": session_id,
        "resuming_from": next_idx,
        "total": len(all_laws),
    }


@app.get("/admin/rada/logs")
async def rada_logs():
    with _lock:
        running = _sync["rada"]["running"]
        pause_req = _sync["rada"]["pause_requested"]
        logs = list(_sync["rada"]["live_logs"])

    state = _load_state()
    can_resume = (
        not running
        and state is not None
        and state.get("source") == "rada"
    )

    return {
        "running": running,
        "pause_requested": pause_req,
        "can_resume": can_resume,
        "resume_progress": {
            "next_index": state["next_index"],
            "total": len(state["all_laws"]),
        } if can_resume and state else None,
        "live_logs": logs,
        "history": _sb_get_logs("rada", 20),
    }


@app.get("/admin/rada/schedule")
async def get_schedule():
    return {"enabled": settings_cache.get_bool("schedule_enabled", False)}


@app.post("/admin/rada/schedule")
async def set_schedule(body: ScheduleBody):
    _sb_update_schedule(body.enabled)
    await settings_cache.refresh()
    return {"enabled": body.enabled}


# ── /admin/supreme/* ───────────────────────────────────────────────────────────

@app.post("/admin/supreme/trigger")
async def trigger_supreme():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("supreme", _do_supreme, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.get("/admin/supreme/logs")
async def supreme_logs():
    with _lock:
        running = _sync["supreme"]["running"]
        logs = list(_sync["supreme"]["live_logs"])
    return {
        "running": running,
        "live_logs": logs,
        "history": _sb_get_logs("supreme", 20),
    }


# ── /admin/wiki/* ──────────────────────────────────────────────────────────────

@app.post("/admin/wiki/trigger")
async def trigger_wiki():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("wiki", _do_wiki, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.get("/admin/wiki/logs")
async def wiki_logs():
    with _lock:
        running = _sync["wiki"]["running"]
        logs = list(_sync["wiki"]["live_logs"])
    return {
        "running": running,
        "live_logs": logs,
        "history": _sb_get_logs("wiki", 20),
    }


# ── /admin/templates/* ────────────────────────────────────────────────────────

@app.post("/admin/templates/trigger")
async def trigger_templates():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("templates", _do_templates, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.get("/admin/templates/logs")
async def templates_logs():
    with _lock:
        running = _sync["templates"]["running"]
        logs = list(_sync["templates"]["live_logs"])
    return {
        "running": running,
        "live_logs": logs,
        "history": _sb_get_logs("templates", 20),
    }


# ── /admin/laws/text ──────────────────────────────────────────────────────────

@app.get("/admin/laws/text")
async def get_law_text_endpoint(law_id: str):
    """Повертає повний текст закону з Qdrant (конкатенація всіх чанків)."""
    if not law_id:
        raise HTTPException(400, "law_id required")
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from qdrant_storage import get_client, COLLECTION_NAME

        client = get_client()
        all_chunks: list = []
        next_page_offset = None
        while True:
            batch, next_page_offset = client.scroll(
                collection_name=COLLECTION_NAME,
                scroll_filter=Filter(must=[
                    FieldCondition(key="law_id", match=MatchValue(value=law_id))
                ]),
                with_payload=True,
                limit=500,
                offset=next_page_offset,
            )
            all_chunks.extend(batch)
            if next_page_offset is None:
                break

        if not all_chunks:
            raise HTTPException(404, "Документ не знайдено")

        all_chunks.sort(key=lambda p: p.payload.get("chunk_index", 0))
        full_text = "\n\n".join(p.payload.get("content", "") for p in all_chunks)
        return {"full_text": full_text, "chunk_count": len(all_chunks)}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ── /admin/base/docs ──────────────────────────────────────────────────────────

@app.get("/admin/base/docs")
async def get_base_docs(page: int = 1, per_page: int = 25, source: str | None = None):
    """Список унікальних документів з Qdrant (chunk_index=0 = один запис на закон)."""
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from qdrant_storage import get_client, COLLECTION_NAME

        client = get_client()

        domain_map = {
            "rada": "zakon.rada.gov.ua",
            "supreme": "supreme.court.gov.ua",
            "wiki": "legalaid.wiki",
        }

        must = [FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        if source and source in domain_map:
            must.append(FieldCondition(key="source_domain", match=MatchValue(value=domain_map[source])))

        scroll_filter = Filter(must=must)

        total = client.count(
            collection_name=COLLECTION_NAME,
            count_filter=scroll_filter,
            exact=True,
        ).count

        # Qdrant scroll не підтримує числовий offset → збираємо всі і нарізаємо
        all_points: list = []
        next_page_offset = None
        while True:
            batch, next_page_offset = client.scroll(
                collection_name=COLLECTION_NAME,
                scroll_filter=scroll_filter,
                with_payload=True,
                limit=1000,
                offset=next_page_offset,
            )
            all_points.extend(batch)
            if next_page_offset is None:
                break

        start = (page - 1) * per_page
        page_points = all_points[start: start + per_page]

        docs = [
            {
                "id": str(p.id),
                "law_id": p.payload.get("law_id", ""),
                "title": p.payload.get("source", ""),
                "category": p.payload.get("category", ""),
                "status": p.payload.get("status", ""),
                "law_url": p.payload.get("law_url", ""),
                "source_domain": p.payload.get("source_domain", ""),
                "scraped_at": p.payload.get("scraped_at", ""),
            }
            for p in page_points
        ]

        return {"total": total, "page": page, "per_page": per_page, "docs": docs}

    except Exception as e:
        raise HTTPException(500, str(e))


# ── /ask — основний чат-ендпоінт ──────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    max_docs: int = 8          # max chunks from Qdrant (from user's plan)
    filter_domains: list[str] | None = None  # allowed source domains (from plan features)


@app.post("/ask")
async def ask(body: AskRequest):
    """Приймає питання → повертає відповідь від Gemini + посилання на закони."""
    import asyncio as _asyncio

    start_time = time.time()
    question = body.question.strip()
    if not question:
        raise HTTPException(400, "question is required")

    # 1. Embed query
    try:
        from rada_to_supabase import embeddings
        query_vector = await _asyncio.to_thread(embeddings.embed_query, question)
    except Exception as e:
        raise HTTPException(500, f"Embedding error: {e}")

    # 2. Search Qdrant (plan-based top_k and domain filter)
    from qdrant_storage import search_qdrant
    results = await _asyncio.to_thread(
        search_qdrant, query_vector, body.max_docs, body.filter_domains or None, 0.0
    )

    # 3. Build citations (Citation format expected by frontend)
    citations: list[dict] = []
    context_parts: list[str] = []

    for i, r in enumerate(results):
        num = i + 1
        meta = r["out_metadata"]
        content = r["out_content"]
        title = meta.get("source", meta.get("title", ""))
        law_id = meta.get("law_id", "")
        source_domain = meta.get("source_domain", "")
        law_url = meta.get("law_url", "")
        if not law_url and "rada.gov.ua" in source_domain and law_id:
            law_url = f"https://zakon.rada.gov.ua/laws/show/{law_id}"

        # Clean passage: strip markdown code fences and excess whitespace
        clean_passage = re.sub(r"```[a-z]*", "", content)
        clean_passage = re.sub(r"\n{3,}", "\n\n", clean_passage).strip()[:600]

        citations.append({
            "num": num,
            "source_title": title,
            "passage": clean_passage,
            "status": meta.get("status", ""),
            "law_url": law_url,
            "chunk_index": meta.get("chunk_index", 0),
        })

        if content:
            context_parts.append(f"[{num}] {title}\n{content}")

    context = "\n\n".join(context_parts) if context_parts else "Контекст відсутній."

    # 4. Call Gemini
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel, GenerationConfig

        creds    = settings_cache.get_credentials()
        project  = settings_cache.get_vertex_project()
        location = settings_cache.get_vertex_location()
        vertexai.init(project=project, location=location, credentials=creds)

        model_name    = settings_cache.get("ai_model", "gemini-2.0-flash-lite")
        system_prompt = settings_cache.get(
            "system_prompt",
            "Ти — досвідчений український адвокат. Надавай точні відповіді виключно на основі наданого контексту.",
        )
        temperature = settings_cache.get_float("temperature", 0.1)

        prompt = (
            f"Контекст з українського законодавства (кожен фрагмент пронумерований):\n\n{context}\n\n"
            f"---\nПитання: {question}\n\n"
            "Надай точну структуровану відповідь. "
            "Посилайся на джерела у форматі [1], [2] одразу після твердження. "
            "Якщо контекст не містить потрібної інформації — чесно повідом про це."
        )

        top_p = settings_cache.get_float("top_p", 0.8)

        model = GenerativeModel(model_name, system_instruction=system_prompt)
        response = await _asyncio.to_thread(
            model.generate_content,
            prompt,
            generation_config=GenerationConfig(temperature=temperature, top_p=top_p),
        )
        answer = response.text
    except Exception as e:
        raise HTTPException(500, f"AI error: {e}")

    # Filter citations — keep only those actually referenced in the answer
    used_nums = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
    used_citations = [c for c in citations if c["num"] in used_nums] or citations[:3]

    elapsed_ms = int((time.time() - start_time) * 1000)

    return {
        "answer": answer,
        "references": used_citations,
        "templates": [],
        "_meta": {"processing_time_ms": elapsed_ms},
    }


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
