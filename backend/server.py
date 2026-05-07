"""
server.py — FastAPI бекенд для URAI (уп Assistant).

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
import logging
from concurrent.futures import ThreadPoolExecutor as _TPE

logger = logging.getLogger("uvicorn.error")

# Ukrainian morphology: lemmatize words for MatchText (відрядженні → відрядження)
try:
    import pymorphy3 as _pymorphy3
    _ua_morph = _pymorphy3.MorphAnalyzer(lang='uk')
    def _ua_lemma(w: str) -> str:
        try:
            return _ua_morph.parse(w.lower())[0].normal_form
        except Exception:
            return w.lower()
    logger.info("pymorphy3 UA morph analyzer ready")
except ImportError:
    def _ua_lemma(w: str) -> str:
        return w.lower()
    logger.warning("pymorphy3 not installed — morphology disabled")
from datetime import datetime, timezone, timedelta
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv

load_dotenv()
import settings_cache  # noqa: E402 — треба після load_dotenv

# ── Vertex AI — ініціалізуємо один раз при старті ─────────────────────────────
_vertex_initialized = False

def _init_vertex_ai() -> bool:
    """Ініціалізує vertexai з поточними налаштуваннями. Повертає True якщо успішно."""
    global _vertex_initialized
    try:
        import vertexai
        creds    = settings_cache.get_credentials()
        project  = settings_cache.get_vertex_project()
        location = settings_cache.get_vertex_location()
        if not project:
            print("⚠️  [Vertex AI] project не знайдено — відкладаємо ініціалізацію")
            return False
        vertexai.init(project=project, location=location, credentials=creds)
        _vertex_initialized = True
        print(f"✅ [Vertex AI] ініціалізовано: project={project}, location={location}")
        return True
    except Exception as e:
        print(f"⚠️  [Vertex AI] помилка ініціалізації: {e}")
        return False

# ── Шляхи до файлів збереженого стану (resume) ───────────────────────────────
BASE_DIR = Path(__file__).parent
SYNC_STATE_FILE     = BASE_DIR / "sync_state.json"       # РАДА
WIKI_STATE_FILE     = BASE_DIR / "wiki_state.json"        # Wiki
CCU_STATE_FILE      = BASE_DIR / "ccu_state.json"         # КСУ
LPD_STATE_FILE      = BASE_DIR / "lpd_state.json"         # Правові позиції ВС
KMU_STATE_FILE      = BASE_DIR / "kmu_state.json"         # НПА КМУ
REINDEX_KMU_STATE   = BASE_DIR / "reindex_kmu_full_state.json"   # Переіндекс КМУ
REINDEX_RADA_STATE  = BASE_DIR / "reindex_rada_full_state.json"  # Переіндекс Ради
# ── V2 scraper sources ─────────────────────────────────────────────────────────
V2_SCRAPE_SOURCES  = ("rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir")
V2_REINDEX_SOURCES = ("rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir")

_TAX_KEYWORDS = ("пдв", "ват", "податк", "єдиний податок", "фоп", "пдфо", "акциз",
                 "реєстрац", "платник", "зir", "зір", "дпс", "митн", "збір")

def _scrape_v2_state_file(source: str) -> Path:
    return BASE_DIR / f"scrape_v2_{source}_state.json"

def _reindex_v2_state_file(source: str | None) -> Path:
    tag = source if source else "all"
    return BASE_DIR / f"reindex_v2_{tag}_state.json"

# ── Supabase ───────────────────────────────────────────────────────────────────
_SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
_SB_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)

# ── In-memory стан по кожному джерелу ─────────────────────────────────────────
_SOURCES = (
    "rada", "supreme", "wiki", "templates", "ccu", "lpd", "kmu",
    "reindex_kmu", "reindex_rada",
    "scrape_v2_rada", "scrape_v2_kmu", "scrape_v2_ccu", "scrape_v2_supreme", "scrape_v2_wiki", "scrape_v2_positions", "scrape_v2_mod", "scrape_v2_zir",
    "reindex_v2",  # "all sources" fallback
    "reindex_v2_rada", "reindex_v2_kmu", "reindex_v2_ccu",
    "reindex_v2_supreme", "reindex_v2_wiki", "reindex_v2_positions", "reindex_v2_mod", "reindex_v2_zir",
    "enrich_opendata",    # збагачення метаданих Rada+KMU через OpenData API
    "extract_text_cancellations",
    "check_text_missing",
    "scrape_text_missing_found",
    "apply_text_cancellations",
    "update_qdrant_meta", # патч Qdrant payload з збагачених meta.json
    "pipeline",           # повний автоматичний пайплайн (6 кроків)
)
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
_reindex_stop = {"kmu": threading.Event(), "rada": threading.Event()}
_v2_stop = {
    "reindex": threading.Event(),  # "all sources"
    **{s: threading.Event() for s in V2_REINDEX_SOURCES},
}
_v2_scrape_stop = {s: threading.Event() for s in V2_SCRAPE_SOURCES}
_enrich_stop     = threading.Event()
_text_cancel_stop = threading.Event()
_text_missing_check_stop = threading.Event()
_text_missing_scrape_stop = threading.Event()
_apply_text_cancel_stop = threading.Event()
_qdrant_meta_stop = threading.Event()
_pipeline_stop    = threading.Event()

_PIPELINE_LAST_RUN_FILE    = BASE_DIR / "pipeline_last_run.json"
_PIPELINE_RESUME_FILE      = BASE_DIR / "pipeline_resume_state.json"
_PIPELINE_SOURCES = list(V2_SCRAPE_SOURCES)  # all 8 sources


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
    """Загальна кількість векторів у всіх колекціях Qdrant."""
    try:
        from qdrant_storage import get_total_doc_count
        return get_total_doc_count()
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

# Семафор: максимум 2 паралельних HTTP-запити до zakon.rada.gov.ua (безпечно)
_rada_http_sem = threading.Semaphore(2)

# Кількість паралельних воркерів для обробки законів
# Семафор(2) обмежує HTTP до ради незалежно від кількості воркерів — безпечно
RADA_WORKERS = 3


def _do_rada(
    session_id: str,
    start_index: int = 0,
    all_laws_cached: list | None = None,
    section_codes: list[str] | None = None,
) -> None:
    """
    Головна функція синхронізації Ради.
    Підтримує: старт з нуля, resume з індексу, пауза після поточного батча.
    section_codes — selected sections (None = all ALL_THEMES).
    RADA_WORKERS законів обробляються паралельно.
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

    # V1 reindex is deprecated — use V2 scraper + reindex_v2.py instead (/admin/v2)
    log("⚠️  Рада V1 реіндекс застарів. Використовуйте V2 скрапер + реіндекс у /admin/v2.", "warning")
    _sb_update_log(session_id, status="error", finished_at=datetime.now(timezone.utc).isoformat(),
                   laws_processed=0, error_message="V1 reindex deprecated — use /admin/v2")
    with _lock:
        _sync[src]["running"] = False
    return



def _do_supreme(session_id: str) -> None:
    src = "supreme"
    log = lambda m, lv="info": _log(src, m, lv)
    log("=" * 50)
    log(f"⚖️ SUPREME SYNC (сесія {session_id[:8]}...)")
    log("=" * 50)
    _sb_insert_log(src, session_id)
    processed = 0
    try:
        from supreme_scanner import get_supreme_reviews, process_supreme_pdf
        from rada_to_supabase import get_existing_law_ids

        reviews = get_supreme_reviews()
        log(f"🔎 Знайдено оглядів: {len(reviews)}")

        existing_ids = get_existing_law_ids()
        log(f"📋 Вже в базі: {len(existing_ids)} документів")

        total = len(reviews)

        for i, review in enumerate(reviews):
            # ── Перевірка запиту на паузу ─────────────────────────────────
            with _lock:
                pause = _sync[src]["pause_requested"]
            if pause:
                log(f"⏸️  Призупинено на {i}/{total}. Оброблено: {processed}", "warning")
                _sb_update_log(
                    session_id,
                    status="paused",
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    laws_processed=processed,
                    error_message=f"Призупинено на документі {i}/{total}",
                )
                with _lock:
                    _sync[src]["running"] = False
                    _sync[src]["pause_requested"] = False
                return

            log(f"📥 [{i + 1}/{total}] Обробка: {review['title']}")
            process_supreme_pdf(
                review["url"], review["title"],
                session_id=session_id, existing_ids=existing_ids,
            )
            processed += 1
            log(f"  ✅ Готово! (всього оброблено: {processed})", "success")

            # Оновлюємо in-memory лічильник і Supabase кожні 10 законів
            with _lock:
                _sync["supreme"]["laws_processed"] = processed
            if processed % 10 == 0:
                _sb_update_log(session_id, laws_processed=processed)

            time.sleep(2)

        _sb_update_log(
            session_id,
            status="success",
            finished_at=datetime.now(timezone.utc).isoformat(),
            laws_processed=processed,
        )
        log(f"✅ Верховний Суд завершено. Оброблено: {processed} документів.", "success")
    except Exception as e:
        log(f"❌ {e}", "error")
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


def _do_wiki(session_id: str, start_index: int = 0, articles_cached: list | None = None) -> None:
    src = "wiki"
    log = lambda m, lv="info": _log(src, m, lv)
    log("=" * 50)
    log(f"📚 WIKI SYNC (сесія {session_id[:8]}...)")
    log("=" * 50)
    _sb_insert_log(src, session_id)
    processed = 0
    try:
        from wiki_scanner import get_all_wiki_articles, scrape_wiki_article
        from qdrant_storage import get_existing_law_ids

        if articles_cached:
            articles = articles_cached
            log(f"▶️  Відновлення з індексу {start_index}")
        else:
            articles = get_all_wiki_articles()

        log(f"🔎 Знайдено статей: {len(articles)}")
        existing_ids = get_existing_law_ids()
        log(f"📋 Вже в базі: {len(existing_ids)} документів")
        total = len(articles)

        for i, art in enumerate(articles):
            if i < start_index:
                continue

            # ── Перевірка запиту на паузу ─────────────────────────────────
            with _lock:
                pause = _sync[src]["pause_requested"]
            if pause:
                # Зберігаємо стан для відновлення
                WIKI_STATE_FILE.write_text(
                    json.dumps({
                        "source": "wiki",
                        "articles": articles,
                        "next_index": i,
                        "session_id": session_id,
                        "saved_at": datetime.now(timezone.utc).isoformat(),
                    }, ensure_ascii=False),
                    encoding="utf-8",
                )
                log(f"⏸️  Призупинено на {i}/{total}. Оброблено: {processed}. Стан збережено.", "warning")
                _sb_update_log(
                    session_id,
                    status="paused",
                    finished_at=datetime.now(timezone.utc).isoformat(),
                    laws_processed=processed,
                    error_message=f"Призупинено на статті {i}/{total}",
                )
                with _lock:
                    _sync[src]["running"] = False
                    _sync[src]["pause_requested"] = False
                return

            log(f"📖 [{i + 1}/{total}] {art['title']}")
            try:
                ok = scrape_wiki_article(
                    art["url"], art["title"],
                    session_id=session_id, existing_ids=existing_ids,
                )
                if ok:
                    processed += 1
                    log(f"  ✅ Готово: {art['title']}", "success")
                else:
                    log(f"  ⏭ Пропущено (актуальна або порожня): {art['title']}")
            except Exception as e:
                log(f"  ❌ Помилка ({art['title']}): {e}", "error")

            with _lock:
                _sync[src]["laws_processed"] = processed
            if (i + 1) % 10 == 0:
                _sb_update_log(session_id, laws_processed=processed)

            time.sleep(1)

        # Успішно завершено — очищаємо збережений стан
        if WIKI_STATE_FILE.exists():
            WIKI_STATE_FILE.unlink()
        _sb_update_log(
            session_id,
            status="success",
            finished_at=datetime.now(timezone.utc).isoformat(),
            laws_processed=processed,
        )
        log(f"✅ Wiki завершено! Оброблено: {processed}/{total} статей.", "success")

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


def _do_ccu(session_id: str, start_index: int = 0, docs_cached: list | None = None) -> None:
    src = "ccu"
    log = lambda m, lv="info": _log(src, m, lv)
    log("=" * 50)
    log(f"⚖️ CCU SYNC (сесія {session_id[:8]}...)")
    log("=" * 50)
    _sb_insert_log(src, session_id)
    processed = 0
    try:
        from ccu_scanner import run_ccu_sync

        _state_holder = {"next_index": start_index, "docs": docs_cached}

        def pause_check():
            with _lock:
                return _sync[src]["pause_requested"]

        def on_pause(docs: list, next_idx: int, ok: int) -> None:
            """Зберігає стан при паузі."""
            CCU_STATE_FILE.write_text(
                json.dumps({
                    "source": "ccu",
                    "docs": docs,
                    "next_index": next_idx,
                    "session_id": session_id,
                    "saved_at": datetime.now(timezone.utc).isoformat(),
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            log(f"💾 Стан КСУ збережено (індекс {next_idx})", "warning")

        def log_callback(msg: str, level: str = "info"):
            _lvl = level if level != "info" else (
                "error"   if "❌" in msg else
                "success" if "✅" in msg else
                "warning" if "⚠️" in msg or "⏸️" in msg else "info"
            )
            log(msg, _lvl)
            with _lock:
                _sync[src]["laws_processed"] = processed

        ok, total = run_ccu_sync(
            session_id=session_id,
            log_callback=log_callback,
            pause_check=pause_check,
            on_pause=on_pause,
            start_index=start_index,
            docs_cached=docs_cached,
        )
        processed = ok

        with _lock:
            paused = _sync[src]["pause_requested"]

        if paused:
            _sb_update_log(
                session_id,
                status="paused",
                finished_at=datetime.now(timezone.utc).isoformat(),
                laws_processed=processed,
                error_message="Призупинено",
            )
        else:
            # Успішно — очищаємо збережений стан
            if CCU_STATE_FILE.exists():
                CCU_STATE_FILE.unlink()
            _sb_update_log(
                session_id,
                status="success",
                finished_at=datetime.now(timezone.utc).isoformat(),
                laws_processed=processed,
            )
            log(f"✅ КСУ синхронізацію завершено. Оброблено: {processed}/{total}.", "success")

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


def _do_lpd(session_id: str, start_index: int = 0, positions_cached: list | None = None) -> None:
    src = "lpd"
    log = lambda m, lv="info": _log(src, m, lv)
    log("=" * 50)
    log(f"⚖️  LPD SYNC (сесія {session_id[:8]}...)")
    log("=" * 50)
    _sb_insert_log(src, session_id)
    processed = 0
    try:
        from lpd_scanner import run_lpd_sync

        def pause_check():
            with _lock:
                return _sync[src]["pause_requested"]

        def on_pause(positions: list, next_idx: int, ok: int) -> None:
            LPD_STATE_FILE.write_text(
                json.dumps({
                    "source":     "lpd",
                    "positions":  positions,
                    "next_index": next_idx,
                    "session_id": session_id,
                    "saved_at":   datetime.now(timezone.utc).isoformat(),
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            log(f"💾 Стан LPD збережено (індекс {next_idx})", "warning")

        def log_callback(msg: str, level: str = "info"):
            _lvl = level if level != "info" else (
                "error"   if "❌" in msg else
                "success" if "✅" in msg else
                "warning" if "⚠️" in msg or "⏸️" in msg else "info"
            )
            log(msg, _lvl)
            with _lock:
                _sync[src]["laws_processed"] = processed

        ok, total = run_lpd_sync(
            session_id=session_id,
            log_callback=log_callback,
            pause_check=pause_check,
            on_pause=on_pause,
            start_index=start_index,
            positions_cached=positions_cached,
        )
        processed = ok

        with _lock:
            paused = _sync[src]["pause_requested"]

        if paused:
            _sb_update_log(session_id, status="paused",
                           finished_at=datetime.now(timezone.utc).isoformat(),
                           laws_processed=processed, error_message="Призупинено")
        else:
            if LPD_STATE_FILE.exists():
                LPD_STATE_FILE.unlink()
            _sb_update_log(session_id, status="success",
                           finished_at=datetime.now(timezone.utc).isoformat(),
                           laws_processed=processed)
            log(f"✅ LPD синхронізацію завершено. Оброблено: {processed}/{total}.", "success")

    except Exception as e:
        log(f"❌ Критична помилка: {e}", "error")
        _sb_update_log(session_id, status="error",
                       finished_at=datetime.now(timezone.utc).isoformat(),
                       laws_processed=processed, error_message=str(e))
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_kmu(session_id: str, start_index: int = 0, docs_cached: list | None = None) -> None:
    src = "kmu"
    log = lambda m, lv="info": _log(src, m, lv)
    log("=" * 50)
    log(f"🏛️  KMU SYNC (сесія {session_id[:8]}...)")
    log("=" * 50)
    _sb_insert_log(src, session_id)
    processed = 0
    try:
        from kmu_scanner import run_kmu_sync

        def pause_check():
            with _lock:
                return _sync[src]["pause_requested"]

        def on_pause(docs: list, next_idx: int, ok: int) -> None:
            KMU_STATE_FILE.write_text(
                json.dumps({
                    "source":     "kmu",
                    "docs":       docs,
                    "next_index": next_idx,
                    "session_id": session_id,
                    "saved_at":   datetime.now(timezone.utc).isoformat(),
                }, ensure_ascii=False),
                encoding="utf-8",
            )
            log(f"💾 Стан KMU збережено (індекс {next_idx})", "warning")

        def log_callback(msg: str, level: str = "info"):
            _lvl = level if level != "info" else (
                "error"   if "❌" in msg else
                "success" if "✅" in msg else
                "warning" if "⚠️" in msg or "⏸️" in msg else "info"
            )
            log(msg, _lvl)
            with _lock:
                _sync[src]["laws_processed"] = processed

        ok, total = run_kmu_sync(
            session_id=session_id,
            log_callback=log_callback,
            pause_check=pause_check,
            on_pause=on_pause,
            start_index=start_index,
            docs_cached=docs_cached,
        )
        processed = ok

        with _lock:
            paused = _sync[src]["pause_requested"]

        if paused:
            _sb_update_log(session_id, status="paused",
                           finished_at=datetime.now(timezone.utc).isoformat(),
                           laws_processed=processed, error_message="Призупинено")
        else:
            if KMU_STATE_FILE.exists():
                KMU_STATE_FILE.unlink()
            _sb_update_log(session_id, status="success",
                           finished_at=datetime.now(timezone.utc).isoformat(),
                           laws_processed=processed)
            log(f"✅ KMU синхронізацію завершено. Оброблено: {processed}/{total}.", "success")

    except Exception as e:
        log(f"❌ Критична помилка: {e}", "error")
        _sb_update_log(session_id, status="error",
                       finished_at=datetime.now(timezone.utc).isoformat(),
                       laws_processed=processed, error_message=str(e))
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


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
            "laws_processed": 0,
        })
    threading.Thread(
        target=fn,
        kwargs={"session_id": session_id, **kwargs},
        daemon=True,
    ).start()


# ══════════════════════════════════════════════════════════════════════════════
# APScheduler — автоматичний щоденний запуск (всі джерела)
# ══════════════════════════════════════════════════════════════════════════════

_scheduler = BackgroundScheduler(timezone="UTC")

# Стан останнього авто-запуску по кожному джерелу (зберігається в пам'яті)
_schedule_last_sync: dict[str, dict] = {}  # {ts: str, logs: list[str]}

# Всі джерела що підтримують авто-синхронізацію
_ALL_SCHEDULE_SOURCES = ("rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir")


def _scheduled_sync() -> None:
    """Викликається щодня о schedule_hour UTC. Запускає пайплайн або окремі джерела."""
    print("⏰ [scheduler] Перевірка авто-синхронізації...")

    # Pipeline mode — якщо увімкнено, запускає повний 6-крокований пайплайн
    if settings_cache.get_bool("schedule_pipeline_enabled", False):
        with _lock:
            if _sync["pipeline"]["running"]:
                print("⏰ [scheduler] Пайплайн вже виконується — пропускаємо")
                return
        session_id = str(uuid.uuid4())
        print(f"⏰ [scheduler] Pipeline: {session_id[:8]}")
        try:
            _start_sync("pipeline", _do_pipeline, session_id)
            _schedule_last_sync["pipeline"] = datetime.utcnow().isoformat() + "Z"
        except Exception as e:
            print(f"⏰ [scheduler] Pipeline помилка: {e}")
        return  # pipeline mode: don't also run individual scrapers

    # Legacy Рада — V1 flow
    if settings_cache.get_bool("schedule_enabled", False):
        with _lock:
            if not _sync["rada"]["running"]:
                session_id = str(uuid.uuid4())
                print(f"⏰ [scheduler] Рада (legacy): {session_id[:8]}")
                try:
                    _start_sync("rada", _do_rada, session_id)
                    _schedule_last_sync["rada"] = datetime.utcnow().isoformat() + "Z"
                except Exception as e:
                    print(f"⏰ [scheduler] Рада помилка: {e}")
            else:
                print("⏰ [scheduler] Рада вже виконується — пропускаємо")

    # V2 джерела — scrape_all_v2 / scrape_mod_v2 / scrape_zir_v2
    for src in V2_SCRAPE_SOURCES:
        key = f"schedule_{src}_enabled"
        if not settings_cache.get_bool(key, False):
            continue
        slot = f"scrape_v2_{src}"
        with _lock:
            if _sync[slot]["running"]:
                print(f"⏰ [scheduler] {src} вже виконується — пропускаємо")
                continue
        session_id = str(uuid.uuid4())
        print(f"⏰ [scheduler] {src}: {session_id[:8]}")
        try:
            _start_sync(slot, _do_scrape_v2, session_id, source=src, rada_collection=None, force=False)
            _schedule_last_sync[src] = datetime.utcnow().isoformat() + "Z"
        except Exception as e:
            print(f"⏰ [scheduler] {src} помилка: {e}")


def _reschedule(hour: int) -> None:
    """Перепланувати cron job на нову годину."""
    try:
        _scheduler.reschedule_job("daily_sync", trigger="cron", hour=hour, minute=0)
        print(f"⏰ [scheduler] Перенесено на {hour:02d}:00 UTC")
    except Exception as e:
        print(f"⏰ [scheduler] reschedule error: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# FastAPI app
# ══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings_cache.load()
    _init_vertex_ai()

    # Створюємо всі Qdrant V2 колекції якщо їх немає (безпечно — існуючі пропускає)
    try:
        from qdrant_storage import init_v2_collections, ensure_text_indexes
        import threading as _threading
        init_v2_collections()
        print("✅ Qdrant V2 collections ready.")
        # Full-text індекси — запускаємо у фоні щоб не блокувати старт
        _threading.Thread(target=ensure_text_indexes, daemon=True).start()
        print("🔍 Full-text index init started in background.")
    except Exception as e:
        print(f"⚠️  Qdrant init warning: {e}")

    # Перевіряємо наявність збереженого стану
    state = _load_state()
    if state and state.get("source") == "rada":
        idx = state.get("next_index", 0)
        total = len(state.get("all_laws", []))
        print(f"⚠️  Знайдено збережений стан: Рада, прогрес {idx}/{total}")

    schedule_hour = int(settings_cache.get_float("schedule_hour") or 1)
    _scheduler.add_job(_scheduled_sync, "cron", hour=schedule_hour, minute=0, id="daily_sync")
    _scheduler.start()
    print(f"✅ URAI backend ready. Scheduler: {schedule_hour:02d}:00 UTC")
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

    # Per-collection breakdown for new multi-collection architecture
    from qdrant_storage import get_collection_stats, get_unique_law_count
    collection_stats = get_collection_stats()
    total = sum(collection_stats.values())
    law_count_data = get_unique_law_count()  # None якщо помилка

    return {
        "doc_count": total,
        "law_count": law_count_data["total"] if law_count_data else None,
        "law_count_per_collection": law_count_data["per_collection"] if law_count_data else None,
        "collection_stats": collection_stats,
        "last_sync": history[0] if history else None,
        "schedule_enabled": settings_cache.get_bool("schedule_enabled", False),
        "scraping_running": running,
        "can_resume": can_resume,
        "resume_progress": {
            "next_index": state["next_index"],
            "total": len(state["all_laws"]),
        } if can_resume else None,
    }


@app.get("/admin/text-index/status")
async def get_text_index_status():
    """Статус full-text індексів по всіх колекціях."""
    from qdrant_storage import get_text_index_status
    status = get_text_index_status()
    total = len(status)
    ready = sum(1 for s in status.values() if s == "ready")
    return {
        "status": status,
        "ready_count": ready,
        "total_count": total,
        "all_ready": ready == total,
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


# ── /admin/sync — multi-source schedule management ────────────────────────────

@app.get("/admin/sync/status")
async def get_sync_status():
    """Стан авто-синхронізації по кожному джерелу."""
    schedule_hour = int(settings_cache.get_float("schedule_hour") or 1)
    sources = {}
    for src in _ALL_SCHEDULE_SOURCES:
        key = f"schedule_{src}_enabled" if src != "rada" else "schedule_enabled"
        slot = f"scrape_v2_{src}" if src != "rada" else "rada"
        with _lock:
            running = _sync[slot]["running"]
        sources[src] = {
            "enabled":   settings_cache.get_bool(key, False),
            "running":   running,
            "last_sync": _schedule_last_sync.get(src),
        }
    with _lock:
        pipeline_running = _sync["pipeline"]["running"]
    last_run = None
    if _PIPELINE_LAST_RUN_FILE.exists():
        try:
            last_run = json.loads(_PIPELINE_LAST_RUN_FILE.read_text("utf-8")).get("ts")
        except Exception:
            pass
    return {
        "schedule_hour":     schedule_hour,
        "sources":           sources,
        "pipeline_enabled":  settings_cache.get_bool("schedule_pipeline_enabled", False),
        "pipeline_running":  pipeline_running,
        "pipeline_last_run": last_run,
    }


@app.patch("/admin/sync/settings")
async def patch_sync_settings(body: dict = Body(default={})):
    """Оновити розклад авто-синхронізації. Приймає:
    { schedule_hour: int, sources: { rada: bool, kmu: bool, ... } }"""
    if not _SB_URL:
        raise HTTPException(500, "Supabase не налаштовано")

    updated = []

    def _sb_upsert(row: dict) -> None:
        with httpx.Client(timeout=10) as c:
            r = c.post(
                f"{_SB_URL}/rest/v1/app_settings?on_conflict=key",
                headers={**_sb_hdrs(prefer_minimal=True), "Prefer": "resolution=merge-duplicates,return=minimal"},
                json=row,
            )
            r.raise_for_status()

    # Оновити schedule_hour
    new_hour = body.get("schedule_hour")
    if new_hour is not None:
        new_hour = max(0, min(23, int(new_hour)))
        await asyncio.to_thread(_sb_upsert, {"key": "schedule_hour", "value_text": str(new_hour), "value_bool": None, "value_int": None})
        _reschedule(new_hour)
        updated.append(f"schedule_hour={new_hour}")

    # Оновити pipeline_enabled
    pipeline_enabled = body.get("pipeline_enabled")
    if pipeline_enabled is not None:
        await asyncio.to_thread(_sb_upsert, {"key": "schedule_pipeline_enabled", "value_bool": bool(pipeline_enabled), "value_text": None, "value_int": None})
        updated.append(f"schedule_pipeline_enabled={pipeline_enabled}")

    # Оновити per-source enabled flags
    sources_patch = body.get("sources", {})
    for src, enabled in sources_patch.items():
        if src not in _ALL_SCHEDULE_SOURCES:
            continue
        key = f"schedule_{src}_enabled" if src != "rada" else "schedule_enabled"
        await asyncio.to_thread(_sb_upsert, {"key": key, "value_bool": bool(enabled), "value_text": None, "value_int": None})
        updated.append(f"{key}={enabled}")

    await asyncio.to_thread(settings_cache.load)
    return {"updated": updated}


@app.post("/admin/settings/refresh")
async def refresh_settings(request: Request):
    """Перечитує налаштування з Supabase і оновлює кеш + Vertex AI.
    Доступно лише з localhost (викликається Next.js сервером)."""
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Forbidden: internal endpoint")
    await settings_cache.refresh()
    _init_vertex_ai()
    return {"ok": True}


@app.get("/admin/debug-search")
async def debug_search(q: str, request: Request):
    """Показує які колекції обрано та топ-документи для запиту. Localhost only."""
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Forbidden: internal endpoint")
    try:
        import embed_v2 as _embed_v2
        from qdrant_storage import search_qdrant, ALL_V2_COLLECTIONS
        import asyncio as _aio
        q_vec = await _aio.to_thread(_embed_v2.embed_query, q)
        collections = _route_collections(q, ALL_V2_COLLECTIONS, q_vec)
        results = await _aio.to_thread(search_qdrant, q_vec, 5, collections, 0.0)
        return {
            "collections_searched": collections,
            "top_docs": [
                {
                    "score": round(r["similarity"], 4),
                    "collection": r["_collection"],
                    "law_id": r["out_metadata"].get("law_id", ""),
                    "title": r["out_metadata"].get("source", "")[:80],
                    "snippet": r["out_content"][:200],
                }
                for r in results
            ],
        }
    except Exception as e:
        return {"error": str(e)}


@app.get("/admin/centroid-status")
async def get_centroid_status(request: Request):
    """Повертає статус та метадані centroid router. Localhost only."""
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Forbidden: internal endpoint")
    return _centroid_status()


@app.post("/admin/rebuild-centroids")
async def rebuild_centroids(request: Request):
    """Запускає перебудову centroid-векторів у фоні та повертає одразу.
    Фронт поллить /admin/centroid-status щоб дізнатись коли готово. Localhost only."""
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Forbidden: internal endpoint")

    global _centroid_building
    if _centroid_building:
        return {"ok": False, "status": "already_building"}

    async def _bg():
        global _centroids, _centroid_building
        try:
            import asyncio
            from qdrant_storage import ALL_V2_COLLECTIONS
            new_centroids = await asyncio.to_thread(_compute_centroids, ALL_V2_COLLECTIONS)
            with _centroids_lock:
                _centroids = new_centroids
            logger.info(f"CENTROID ✅ Centroid rebuild complete ({len(new_centroids)} collections)")
        except Exception as e:
            logger.info(f"CENTROID ❌ Centroid rebuild failed: {e}")
        finally:
            _centroid_building = False

    import asyncio
    _centroid_building = True  # виставляємо ДО ensure_future, щоб status відразу бачив True
    asyncio.ensure_future(_bg())
    return {"ok": True, "status": "building"}


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


@app.post("/admin/supreme/pause")
async def pause_supreme():
    """Запрошує паузу. Поточний документ буде допрацьовано, потім зупинка."""
    with _lock:
        if not _sync["supreme"]["running"]:
            raise HTTPException(400, "Синхронізація не виконується")
        _sync["supreme"]["pause_requested"] = True
    return {"ok": True, "message": "Пауза запрошена — поточний документ буде завершено"}


@app.get("/admin/supreme/logs")
async def supreme_logs():
    with _lock:
        running = _sync["supreme"]["running"]
        pause_req = _sync["supreme"]["pause_requested"]
        logs = list(_sync["supreme"]["live_logs"])
    return {
        "running": running,
        "pause_requested": pause_req,
        "can_resume": False,
        "live_logs": logs,
        "history": _sb_get_logs("supreme", 20),
    }


@app.get("/admin/supreme/laws")
async def supreme_laws(
    page: int = 1,
    per_page: int = 25,
    search: str | None = None,
):
    """Список унікальних рішень Верховного Суду з Qdrant (chunk_index=0)."""
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from qdrant_storage import get_client

        client = get_client()
        scroll_filter = Filter(must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))])

        all_points: list = []
        try:
            next_page_offset = None
            while True:
                batch, next_page_offset = client.scroll(
                    collection_name="laws_supreme_v2",
                    scroll_filter=scroll_filter,
                    with_payload=True,
                    limit=1000,
                    offset=next_page_offset,
                )
                all_points.extend(batch)
                if next_page_offset is None:
                    break
        except Exception:
            pass  # колекція порожня або недоступна

        if search:
            q = search.strip().lower()
            all_points = [
                p for p in all_points
                if q in (p.payload.get("source") or "").lower()
                or q in (p.payload.get("law_id") or "").lower()
            ]

        total = len(all_points)
        start = (page - 1) * per_page
        page_points = all_points[start: start + per_page]

        laws = [
            {
                "id": str(p.id),
                "content": p.payload.get("content", ""),
                "metadata": {
                    "law_id":      p.payload.get("law_id", ""),
                    "source":      p.payload.get("source", ""),
                    "status":      p.payload.get("status", ""),
                    "law_url":     p.payload.get("law_url", ""),
                    "category":    p.payload.get("category", ""),
                    "chunk_index": p.payload.get("chunk_index", 0),
                    "scraped_at":  p.payload.get("scraped_at", ""),
                },
            }
            for p in page_points
        ]

        return {"total": total, "page": page, "per_page": per_page, "laws": laws}

    except Exception as e:
        raise HTTPException(500, str(e))


# ── /admin/wiki/* ──────────────────────────────────────────────────────────────

@app.post("/admin/wiki/trigger")
async def trigger_wiki():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("wiki", _do_wiki, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


@app.post("/admin/wiki/pause")
async def pause_wiki():
    with _lock:
        if not _sync["wiki"]["running"]:
            raise HTTPException(409, "Wiki sync is not running")
        _sync["wiki"]["pause_requested"] = True
    return {"ok": True}


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


# ── /admin/ccu/* ──────────────────────────────────────────────────────────────

@app.post("/admin/ccu/trigger")
async def trigger_ccu():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("ccu", _do_ccu, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/ccu/pause")
async def pause_ccu():
    with _lock:
        if not _sync["ccu"]["running"]:
            raise HTTPException(400, "Синхронізація не виконується")
        _sync["ccu"]["pause_requested"] = True
    return {"ok": True, "message": "Пауза запрошена"}


@app.get("/admin/ccu/logs")
async def ccu_logs():
    with _lock:
        running   = _sync["ccu"]["running"]
        pause_req = _sync["ccu"]["pause_requested"]
        logs      = list(_sync["ccu"]["live_logs"])
    state = None
    if CCU_STATE_FILE.exists():
        try:
            s = json.loads(CCU_STATE_FILE.read_text(encoding="utf-8"))
            state = {"next_index": s.get("next_index"), "saved_at": s.get("saved_at"), "total": len(s.get("docs", []))}
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      state is not None and not running,
        "resume_progress": state,
        "history":         _sb_get_logs("ccu", 20),
    }


@app.post("/admin/ccu/resume")
async def resume_ccu():
    if _sync["ccu"]["running"]:
        raise HTTPException(409, "КСУ вже виконується")
    if not CCU_STATE_FILE.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")
    try:
        state = json.loads(CCU_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Помилка читання стану: {e}")
    session_id = str(uuid.uuid4())
    _start_sync("ccu", _do_ccu, session_id,
                start_index=state["next_index"],
                docs_cached=state.get("docs"))
    return {"ok": True, "session_id": session_id, "resume_from": state["next_index"]}


# ── /admin/lpd/* ──────────────────────────────────────────────────────────────

@app.post("/admin/lpd/trigger")
async def trigger_lpd():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("lpd", _do_lpd, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/lpd/pause")
async def pause_lpd():
    with _lock:
        if not _sync["lpd"]["running"]:
            raise HTTPException(400, "Синхронізація не виконується")
        _sync["lpd"]["pause_requested"] = True
    return {"ok": True, "message": "Пауза запрошена"}


@app.get("/admin/lpd/logs")
async def lpd_logs():
    with _lock:
        running   = _sync["lpd"]["running"]
        pause_req = _sync["lpd"]["pause_requested"]
        logs      = list(_sync["lpd"]["live_logs"])
    state = None
    if LPD_STATE_FILE.exists():
        try:
            s = json.loads(LPD_STATE_FILE.read_text(encoding="utf-8"))
            state = {
                "next_index": s.get("next_index"),
                "saved_at":   s.get("saved_at"),
                "total":      len(s.get("positions", [])),
            }
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      state is not None and not running,
        "resume_progress": state,
        "history":         _sb_get_logs("lpd", 20),
    }


@app.post("/admin/lpd/resume")
async def resume_lpd():
    if _sync["lpd"]["running"]:
        raise HTTPException(409, "LPD вже виконується")
    if not LPD_STATE_FILE.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")
    try:
        state = json.loads(LPD_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Помилка читання стану: {e}")
    session_id = str(uuid.uuid4())
    _start_sync("lpd", _do_lpd, session_id,
                start_index=state["next_index"],
                positions_cached=state.get("positions"))
    return {"ok": True, "session_id": session_id, "resume_from": state["next_index"]}


@app.get("/admin/wiki/logs")
async def wiki_logs():
    with _lock:
        running   = _sync["wiki"]["running"]
        pause_req = _sync["wiki"]["pause_requested"]
        logs      = list(_sync["wiki"]["live_logs"])
    state = None
    if WIKI_STATE_FILE.exists():
        try:
            s = json.loads(WIKI_STATE_FILE.read_text(encoding="utf-8"))
            state = {"next_index": s.get("next_index"), "saved_at": s.get("saved_at"), "total": len(s.get("articles", []))}
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      state is not None and not running,
        "resume_progress": state,
        "history":         _sb_get_logs("wiki", 20),
    }


@app.post("/admin/wiki/resume")
async def resume_wiki():
    if _sync["wiki"]["running"]:
        raise HTTPException(409, "Wiki вже виконується")
    if not WIKI_STATE_FILE.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")
    try:
        state = json.loads(WIKI_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Помилка читання стану: {e}")
    session_id = str(uuid.uuid4())
    _start_sync("wiki", _do_wiki, session_id,
                start_index=state["next_index"],
                articles_cached=state.get("articles"))
    return {"ok": True, "session_id": session_id, "resume_from": state["next_index"]}


# ── /admin/kmu/* ──────────────────────────────────────────────────────────────

@app.post("/admin/kmu/trigger")
async def trigger_kmu():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("kmu", _do_kmu, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/kmu/pause")
async def pause_kmu():
    with _lock:
        if not _sync["kmu"]["running"]:
            raise HTTPException(400, "Синхронізація не виконується")
        _sync["kmu"]["pause_requested"] = True
    return {"ok": True, "message": "Пауза запрошена"}


@app.get("/admin/kmu/logs")
async def kmu_logs():
    with _lock:
        running   = _sync["kmu"]["running"]
        pause_req = _sync["kmu"]["pause_requested"]
        logs      = list(_sync["kmu"]["live_logs"])
    state = None
    if KMU_STATE_FILE.exists():
        try:
            s = json.loads(KMU_STATE_FILE.read_text(encoding="utf-8"))
            state = {
                "next_index": s.get("next_index"),
                "saved_at":   s.get("saved_at"),
                "total":      len(s.get("docs", [])),
            }
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      state is not None and not running,
        "resume_progress": state,
        "history":         _sb_get_logs("kmu", 20),
    }


@app.post("/admin/kmu/resume")
async def resume_kmu():
    if _sync["kmu"]["running"]:
        raise HTTPException(409, "KMU вже виконується")
    if not KMU_STATE_FILE.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")
    try:
        state = json.loads(KMU_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Помилка читання стану: {e}")
    session_id = str(uuid.uuid4())
    _start_sync("kmu", _do_kmu, session_id,
                start_index=state["next_index"],
                docs_cached=state.get("docs"))
    return {"ok": True, "session_id": session_id, "resume_from": state["next_index"]}


# ── /admin/reindex/* ──────────────────────────────────────────────────────────

def _make_reindex_log_cb(src: str):
    def cb(msg: str, level: str = "info") -> None:
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "message": msg, "level": level}
        with _lock:
            _sync[src]["live_logs"].append(entry)
            if len(_sync[src]["live_logs"]) > MAX_LIVE_LOGS:
                _sync[src]["live_logs"] = _sync[src]["live_logs"][-MAX_LIVE_LOGS:]
    return cb


def _do_reindex_kmu(session_id: str) -> None:
    src = "reindex_kmu"
    log = _make_reindex_log_cb(src)
    try:
        from reindex_kmu_full import run_full_reindex
        _reindex_stop["kmu"].clear()
        run_full_reindex(log_callback=log, stop_event=_reindex_stop["kmu"])
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_reindex_rada(session_id: str) -> None:
    src = "reindex_rada"
    log = _make_reindex_log_cb(src)
    try:
        from reindex_rada_full import run_full_reindex
        _reindex_stop["rada"].clear()
        run_full_reindex(log_callback=log, stop_event=_reindex_stop["rada"])
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


@app.post("/admin/reindex/kmu/trigger")
async def trigger_reindex_kmu():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("reindex_kmu", _do_reindex_kmu, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/reindex/kmu/stop")
async def stop_reindex_kmu():
    with _lock:
        if not _sync["reindex_kmu"]["running"]:
            raise HTTPException(400, "Переіндекс не виконується")
        _reindex_stop["kmu"].set()
        _sync["reindex_kmu"]["pause_requested"] = True
    return {"ok": True}


@app.get("/admin/reindex/kmu/logs")
async def reindex_kmu_logs():
    with _lock:
        running   = _sync["reindex_kmu"]["running"]
        pause_req = _sync["reindex_kmu"]["pause_requested"]
        logs      = list(_sync["reindex_kmu"]["live_logs"])
    state = None
    if REINDEX_KMU_STATE.exists():
        try:
            s = json.loads(REINDEX_KMU_STATE.read_text(encoding="utf-8"))
            state = {"next_index": s.get("start_index"), "ok": s.get("ok", 0), "errors": s.get("errors", 0)}
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      state is not None and not running,
        "resume_progress": state,
    }


@app.post("/admin/reindex/kmu/resume")
async def resume_reindex_kmu():
    if _sync["reindex_kmu"]["running"]:
        raise HTTPException(409, "Переіндекс KMU вже виконується")
    if not REINDEX_KMU_STATE.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")
    session_id = str(uuid.uuid4())
    _start_sync("reindex_kmu", _do_reindex_kmu, session_id)
    return {"ok": True, "session_id": session_id}


@app.post("/admin/reindex/rada/trigger")
async def trigger_reindex_rada():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("reindex_rada", _do_reindex_rada, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/reindex/rada/stop")
async def stop_reindex_rada():
    with _lock:
        if not _sync["reindex_rada"]["running"]:
            raise HTTPException(400, "Переіндекс не виконується")
        _reindex_stop["rada"].set()
        _sync["reindex_rada"]["pause_requested"] = True
    return {"ok": True}


@app.get("/admin/reindex/rada/logs")
async def reindex_rada_logs():
    with _lock:
        running   = _sync["reindex_rada"]["running"]
        pause_req = _sync["reindex_rada"]["pause_requested"]
        logs      = list(_sync["reindex_rada"]["live_logs"])
    state = None
    if REINDEX_RADA_STATE.exists():
        try:
            s = json.loads(REINDEX_RADA_STATE.read_text(encoding="utf-8"))
            state = {"next_index": s.get("start_index"), "ok": s.get("ok", 0), "errors": s.get("errors", 0)}
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      state is not None and not running,
        "resume_progress": state,
    }


@app.post("/admin/reindex/rada/resume")
async def resume_reindex_rada():
    if _sync["reindex_rada"]["running"]:
        raise HTTPException(409, "Переіндекс Ради вже виконується")
    if not REINDEX_RADA_STATE.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")
    session_id = str(uuid.uuid4())
    _start_sync("reindex_rada", _do_reindex_rada, session_id)
    return {"ok": True, "session_id": session_id}


# ── /admin/v2 — Scraper & Reindex v2 (gemini-embedding-001, 3072 dims) ────────

def _do_scrape_v2(session_id: str, source: str, rada_collection: str | None, force: bool = False) -> None:
    slot = f"scrape_v2_{source}"
    log = _make_reindex_log_cb(slot)
    try:
        _v2_scrape_stop[source].clear()
        if source == "mod":
            from scrape_mod_v2 import run_scrape_mod
            run_scrape_mod(log_callback=log, stop_event=_v2_scrape_stop[source], force=force)
        elif source == "zir":
            from scrape_zir_v2 import run_scrape_zir
            run_scrape_zir(log_callback=log, stop_event=_v2_scrape_stop[source], force=force)
        else:
            from scrape_all_v2 import run_scrape_all
            run_scrape_all(source=source, rada_collection=rada_collection,
                           log_callback=log, stop_event=_v2_scrape_stop[source], force=force)
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[slot]["running"] = False
            _sync[slot]["pause_requested"] = False


def _do_reindex_v2(session_id: str, source: str | None, init_only: bool, reset: bool = False) -> None:
    slot     = f"reindex_v2_{source}" if source else "reindex_v2"
    stop_key = source if source else "reindex"
    log = _make_reindex_log_cb(slot)
    try:
        from reindex_v2 import run_reindex_v2
        _v2_stop[stop_key].clear()
        run_reindex_v2(source=source, log_callback=log, stop_event=_v2_stop[stop_key],
                       init_only=init_only, reset=reset)
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[slot]["running"] = False
            _sync[slot]["pause_requested"] = False


@app.get("/admin/v2/scrape/status")
async def v2_scrape_status():
    result = {}
    for source in V2_SCRAPE_SOURCES:
        slot = f"scrape_v2_{source}"
        with _lock:
            running   = _sync[slot]["running"]
            pause_req = _sync[slot]["pause_requested"]
            logs      = list(_sync[slot]["live_logs"])
        state_file = _scrape_v2_state_file(source)
        resume_progress = None
        if state_file.exists():
            try:
                s = json.loads(state_file.read_text(encoding="utf-8"))
                resume_progress = {"inner_idx": s.get("inner_idx", 0), "stats": s.get("stats", {})}
            except Exception:
                pass
        result[source] = {
            "running":         running,
            "pause_requested": pause_req,
            "can_resume":      resume_progress is not None and not running,
            "resume_progress": resume_progress,
            "live_logs":       logs,
        }
    return result


@app.post("/admin/v2/scrape/trigger")
async def v2_scrape_trigger(body: dict = Body(default={})):
    source = body.get("source")
    if source not in V2_SCRAPE_SOURCES:
        raise HTTPException(400, f"source має бути одним із {list(V2_SCRAPE_SOURCES)}")
    rada_collection = body.get("rada_collection") or None
    force = bool(body.get("force", False))
    slot = f"scrape_v2_{source}"
    session_id = str(uuid.uuid4())
    try:
        _start_sync(slot, _do_scrape_v2, session_id,
                    source=source, rada_collection=rada_collection, force=force)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/v2/scrape/stop")
async def v2_scrape_stop(body: dict = Body(default={})):
    source = body.get("source")
    if source not in V2_SCRAPE_SOURCES:
        raise HTTPException(400, f"source має бути одним із {list(V2_SCRAPE_SOURCES)}")
    slot = f"scrape_v2_{source}"
    with _lock:
        if not _sync[slot]["running"]:
            raise HTTPException(400, "Скрапер не виконується")
        _v2_scrape_stop[source].set()
        _sync[slot]["pause_requested"] = True
    return {"ok": True}


@app.get("/admin/v2/scrape/logs")
async def v2_scrape_logs(source: str):
    if source not in V2_SCRAPE_SOURCES:
        raise HTTPException(400, f"source має бути одним із {list(V2_SCRAPE_SOURCES)}")
    slot = f"scrape_v2_{source}"
    with _lock:
        running   = _sync[slot]["running"]
        pause_req = _sync[slot]["pause_requested"]
        logs      = list(_sync[slot]["live_logs"])
    state_file = _scrape_v2_state_file(source)
    resume_progress = None
    if state_file.exists():
        try:
            s = json.loads(state_file.read_text(encoding="utf-8"))
            resume_progress = {"inner_idx": s.get("inner_idx", 0), "stats": s.get("stats", {})}
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      resume_progress is not None and not running,
        "resume_progress": resume_progress,
    }


@app.post("/admin/v2/scrape/resume")
async def v2_scrape_resume(body: dict = Body(default={})):
    source = body.get("source")
    if source not in V2_SCRAPE_SOURCES:
        raise HTTPException(400, f"source має бути одним із {list(V2_SCRAPE_SOURCES)}")
    slot = f"scrape_v2_{source}"
    with _lock:
        if _sync[slot]["running"]:
            raise HTTPException(409, "Скрапер вже виконується")
    state_file = _scrape_v2_state_file(source)
    if not state_file.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")
    rada_collection = body.get("rada_collection") or None
    session_id = str(uuid.uuid4())
    _start_sync(slot, _do_scrape_v2, session_id,
                source=source, rada_collection=rada_collection)
    return {"ok": True, "session_id": session_id}


def _any_reindex_v2_running() -> str | None:
    """Returns the running source name, or None if none running."""
    with _lock:
        for s in V2_REINDEX_SOURCES:
            if _sync[f"reindex_v2_{s}"]["running"]:
                return s
        if _sync["reindex_v2"]["running"]:
            return "all"
    return None


@app.get("/admin/v2/reindex/status")
async def v2_reindex_status():
    """Per-source reindex status: running, resume_progress, live_logs."""
    result = {}
    for source in V2_REINDEX_SOURCES:
        slot = f"reindex_v2_{source}"
        with _lock:
            running   = _sync[slot]["running"]
            pause_req = _sync[slot]["pause_requested"]
            logs      = list(_sync[slot]["live_logs"])
        state_file = _reindex_v2_state_file(source)
        resume_state = None
        if state_file.exists():
            try:
                s = json.loads(state_file.read_text(encoding="utf-8"))
                resume_state = {"file_idx": s.get("file_idx", 0), "stats": s.get("stats", {})}
            except Exception:
                pass
        result[source] = {
            "running":         running,
            "pause_requested": pause_req,
            "can_resume":      resume_state is not None and not running,
            "resume_progress": resume_state,
            "live_logs":       logs,
        }
    return result


@app.post("/admin/v2/reindex/trigger")
async def v2_reindex_trigger(body: dict = Body(default={})):
    source    = body.get("source") or None
    init_only = bool(body.get("init_only", False))
    reset     = bool(body.get("reset", False))

    if source and source not in V2_REINDEX_SOURCES:
        raise HTTPException(400, f"source має бути одним із {list(V2_REINDEX_SOURCES)}")

    # Enforce single-run across all reindex_v2_* slots
    running_src = _any_reindex_v2_running()
    if running_src:
        raise HTTPException(409, f"Реіндекс '{running_src}' вже виконується — зачекайте завершення")

    slot = f"reindex_v2_{source}" if source else "reindex_v2"
    session_id = str(uuid.uuid4())
    try:
        _start_sync(slot, _do_reindex_v2, session_id,
                    source=source, init_only=init_only, reset=reset)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/v2/reindex/stop")
async def v2_reindex_stop(body: dict = Body(default={})):
    source   = body.get("source") or None
    stop_key = source if source else "reindex"
    slot     = f"reindex_v2_{source}" if source else "reindex_v2"
    with _lock:
        if not _sync[slot]["running"]:
            raise HTTPException(400, "Реіндекс не виконується")
        _v2_stop[stop_key].set()
        _sync[slot]["pause_requested"] = True
    return {"ok": True}


@app.get("/admin/v2/reindex/logs")
async def v2_reindex_logs(source: str | None = None):
    """Logs for a specific source (or 'all' if no source given)."""
    slot = f"reindex_v2_{source}" if source else "reindex_v2"
    if slot not in _sync:
        raise HTTPException(400, f"Невідоме джерело: {source}")
    with _lock:
        running   = _sync[slot]["running"]
        pause_req = _sync[slot]["pause_requested"]
        logs      = list(_sync[slot]["live_logs"])
    state_file = _reindex_v2_state_file(source)
    state = None
    if state_file.exists():
        try:
            s = json.loads(state_file.read_text(encoding="utf-8"))
            state = {"file_idx": s.get("file_idx", 0), "stats": s.get("stats", {})}
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "can_resume":      state is not None and not running,
        "resume_progress": state,
    }


@app.post("/admin/v2/reindex/resume")
async def v2_reindex_resume(body: dict = Body(default={})):
    source    = body.get("source") or None
    init_only = bool(body.get("init_only", False))
    slot      = f"reindex_v2_{source}" if source else "reindex_v2"

    running_src = _any_reindex_v2_running()
    if running_src:
        raise HTTPException(409, f"Реіндекс '{running_src}' вже виконується")

    state_file = _reindex_v2_state_file(source)
    if not state_file.exists():
        raise HTTPException(400, "Немає збереженого стану для відновлення")

    session_id = str(uuid.uuid4())
    _start_sync(slot, _do_reindex_v2, session_id,
                source=source, init_only=init_only, reset=False)
    return {"ok": True, "session_id": session_id}


@app.get("/admin/v2/reindex/last-completed")
async def v2_reindex_last_completed():
    """Timestamp of last successful reindex per source (from reindex_v2_{source}_last_completed.json)."""
    from reindex_v2 import SOURCES as _V2_SRC
    result: dict[str, str | None] = {}
    for src in _V2_SRC:
        f = BASE_DIR / f"reindex_v2_{src}_last_completed.json"
        if f.exists():
            try:
                ts = float(json.loads(f.read_text("utf-8")).get("ts", 0))
                result[src] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception:
                result[src] = None
        else:
            result[src] = None
    return result


@app.get("/admin/v2/analytics")
async def v2_analytics(
    status:  str | None = None,
    source:  str | None = None,
    limit:   int = 100,
    offset:  int = 0,
):
    """Аналітика скрапінгу v2: статистика по джерелах, стан колекцій Qdrant."""
    STATUS_FILE_SERVER = Path("/root/laws_raw/scrape_status.json")
    STATUS_FILE_LOCAL  = BASE_DIR.parent / "laws_raw" / "scrape_status.json"

    raw_status: dict = {}
    for sp in [STATUS_FILE_SERVER, STATUS_FILE_LOCAL]:
        if sp.exists():
            try:
                raw_status = json.loads(sp.read_text("utf-8"))
                break
            except Exception:
                pass

    # Summary stats
    by_source: dict = {}
    all_statuses = ["ok", "empty", "restricted", "error"]
    for entry in raw_status.values():
        src = entry.get("source", "unknown")
        st  = entry.get("status", "error")
        if src not in by_source:
            by_source[src] = {s: 0 for s in all_statuses}
        by_source[src][st] = by_source[src].get(st, 0) + 1

    summary = {s: 0 for s in all_statuses}
    summary["total"] = len(raw_status)
    for counts in by_source.values():
        for s in all_statuses:
            summary[s] = summary.get(s, 0) + counts.get(s, 0)

    # Filtered law list
    filtered = [
        {"law_id": k, **{kk: vv for kk, vv in v.items()}}
        for k, v in raw_status.items()
        if (status is None or v.get("status") == status)
        and (source is None or v.get("source") == source)
    ]
    filtered.sort(key=lambda x: x.get("scraped_at", ""), reverse=True)
    total_filtered = len(filtered)
    page = filtered[offset : offset + limit]

    # Qdrant v2 stats
    qdrant_v2: dict = {}
    qdrant_v2_laws: dict = {}  # unique law counts per source (chunk_index==0)
    try:
        from qdrant_storage import ALL_V2_COLLECTIONS, get_client as _qclient
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        qc = _qclient()
        first_chunk_filter = Filter(
            must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        )
        # source prefix → list of matching v2 collection names
        _SRC_COL_MAP: dict[str, list[str]] = {
            "rada":      [c for c in ALL_V2_COLLECTIONS if c.startswith("laws_rada") or c.startswith("rada")],
            "kmu":       ["laws_kmu_v2"],
            "ccu":       ["laws_ccu_v2"],
            "supreme":   ["laws_supreme_v2"],
            "wiki":      ["laws_wiki_v2"],
            "positions": ["laws_positions_v2"],
            "mod":       ["laws_mod_v2"],
            "zir":       ["laws_zir_v2"],
        }
        for col in ALL_V2_COLLECTIONS:
            try:
                qdrant_v2[col] = qc.get_collection(col).points_count or 0
            except Exception:
                qdrant_v2[col] = -1
        for src, cols in _SRC_COL_MAP.items():
            total_laws = 0
            for col in cols:
                try:
                    r = qc.count(col, count_filter=first_chunk_filter, exact=True)
                    total_laws += r.count or 0
                except Exception:
                    pass
            qdrant_v2_laws[src] = total_laws
    except Exception:
        pass

    return {
        "summary":        summary,
        "by_source":      by_source,
        "qdrant_v2":      qdrant_v2,
        "qdrant_v2_laws": qdrant_v2_laws,
        "laws":           page,
        "total_filtered": total_filtered,
    }


@app.get("/admin/v2/disk")
async def v2_disk():
    """Статистика диску: кількість файлів і розмір по кожному джерелу."""
    import shutil
    RAW_PATH = Path("/root/laws_raw")
    SOURCES_V2 = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"]
    result: dict = {}
    for src in SOURCES_V2:
        src_dir = RAW_PATH / src
        if not src_dir.exists():
            result[src] = {"files": 0, "size_mb": 0, "recent": []}
            continue
        txt_files = sorted(src_dir.glob("**/*.txt"), key=lambda p: p.stat().st_mtime, reverse=True)
        total_size = sum(p.stat().st_size for p in txt_files)
        recent = []
        for p in txt_files[:5]:
            law_id_str = str(p.relative_to(src_dir))[:-len(".txt")]
            meta_path = p.parent / f"{p.stem}.meta.json"
            title = ""
            if meta_path.exists():
                try:
                    title = json.loads(meta_path.read_text("utf-8")).get("title", "")[:80]
                except Exception:
                    pass
            recent.append({
                "law_id":   law_id_str,
                "size_kb":  round(p.stat().st_size / 1024, 1),
                "title":    title,
                "mtime":    datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
        result[src] = {
            "files":   len(txt_files),
            "size_mb": round(total_size / 1024 / 1024, 2),
            "recent":  recent,
        }
    # Total disk usage of /root/laws_raw
    total_mb = 0
    if RAW_PATH.exists():
        try:
            total_bytes = sum(f.stat().st_size for f in RAW_PATH.rglob("*") if f.is_file())
            total_mb = round(total_bytes / 1024 / 1024, 2)
        except Exception:
            pass
    return {"sources": result, "total_mb": total_mb}


@app.get("/admin/v2/disk/by-collection")
async def v2_disk_by_collection():
    """Статистика диску Ради по v2-колекціях (розбивка за категоріями)."""
    from qdrant_storage import get_v2_collection_for_category, RADA_V2_COLLECTIONS
    RAW_PATH = Path("/root/laws_raw") / "rada"
    if not RAW_PATH.exists():
        return {"collections": {}}

    counts: dict[str, int] = {}
    errors = 0
    for meta_path in RAW_PATH.glob("**/*.meta.json"):
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
            col = get_v2_collection_for_category(meta.get("category", ""))
            counts[col] = counts.get(col, 0) + 1
        except Exception:
            errors += 1

    for col in RADA_V2_COLLECTIONS:
        if col not in counts:
            counts[col] = 0

    total = sum(counts.values())
    return {
        "total": total,
        "errors": errors,
        "collections": dict(sorted(counts.items(), key=lambda x: -x[1])),
    }


@app.get("/admin/v2/disk/files")
async def v2_disk_files(
    source:  str | None = None,
    search:  str | None = None,
    sort_by: str = "mtime",   # mtime | law_id | size
    order:   str = "desc",
    limit:   int = 50,
    offset:  int = 0,
):
    """Пагінований список файлів на диску з пошуком за ID та назвою."""
    RAW_PATH   = Path("/root/laws_raw")
    SOURCES_V2 = ["rada", "kmu", "ccu", "supreme", "wiki", "positions", "mod", "zir"]
    sources    = [source] if source else SOURCES_V2
    search_lc  = search.lower().strip() if search else None

    entries: list[dict] = []
    for src in sources:
        src_dir = RAW_PATH / src
        if not src_dir.exists():
            continue
        for txt_path in src_dir.glob("**/*.txt"):
            law_id_val = str(txt_path.relative_to(src_dir))[:-len(".txt")]
            meta_path = txt_path.parent / f"{txt_path.stem}.meta.json"
            title = ""
            if meta_path.exists():
                try:
                    title = json.loads(meta_path.read_text("utf-8")).get("title", "")
                except Exception:
                    pass
            if search_lc:
                if search_lc not in law_id_val.lower() and search_lc not in title.lower():
                    continue
            stat = txt_path.stat()
            entries.append({
                "law_id":  law_id_val,
                "source":  src,
                "title":   title[:120],
                "size_kb": round(stat.st_size / 1024, 1),
                "mtime":   datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })

    # Sort
    rev = order == "desc"
    if sort_by == "law_id":
        entries.sort(key=lambda x: x["law_id"], reverse=rev)
    elif sort_by == "size":
        entries.sort(key=lambda x: x["size_kb"], reverse=rev)
    else:
        entries.sort(key=lambda x: x["mtime"], reverse=rev)

    total = len(entries)
    page  = entries[offset : offset + limit]
    return {"files": page, "total": total, "offset": offset, "limit": limit}


@app.get("/admin/v2/disk/law")
async def v2_disk_law(source: str, law_id: str):
    """Повертає текст і метадані конкретного закону з диску."""
    RAW_PATH = Path("/root/laws_raw")
    txt_path  = RAW_PATH / source / f"{law_id}.txt"
    meta_path = RAW_PATH / source / f"{law_id}.meta.json"
    if not txt_path.exists():
        raise HTTPException(404, f"Файл не знайдено: {txt_path}")
    text = txt_path.read_text("utf-8")
    meta: dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
        except Exception:
            pass
    return {
        "law_id":   law_id,
        "source":   source,
        "meta":     meta,
        "text":     text,
        "size_kb":  round(txt_path.stat().st_size / 1024, 1),
        "chars":    len(text),
    }


# ── /admin/logs (unified history across all sources) ─────────────────────────

@app.get("/admin/logs")
async def all_source_logs(limit: int = 20):
    """Повертає останні N записів sync_logs по всіх джерелах."""
    if not _SB_URL:
        return []
    try:
        with httpx.Client(timeout=10) as c:
            r = c.get(
                f"{_SB_URL}/rest/v1/sync_logs",
                headers=_sb_hdrs(),
                params={"order": "started_at.desc", "limit": str(limit)},
            )
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        print(f"⚠️ all_source_logs: {e}")
    return []


# ── /admin/users ──────────────────────────────────────────────────────────────

@app.get("/admin/users/stats")
async def get_users_stats():
    """Aggregate counts for the users page header cards."""
    if not _SB_URL:
        return {"total": 0, "active_7d": 0, "not_onboarded": 0, "trial_used": 0, "by_tier": {}}
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    try:
        with httpx.Client(timeout=15) as c:
            hdrs = {**_sb_hdrs(), "Prefer": "count=exact"}

            def _count(**kw) -> int:
                kw.setdefault("auth_provider", "neq.deleted")
                r = c.get(
                    f"{_SB_URL}/rest/v1/profiles",
                    headers=hdrs,
                    params={"select": "id", "limit": "0", **kw},
                )
                cr = r.headers.get("content-range", "*/0")
                try:
                    v = cr.split("/")[-1]
                    return int(v) if v != "*" else 0
                except (ValueError, IndexError):
                    return 0

            return {
                "total":         _count(),
                "active_7d":     _count(**{"last_active_at": f"gte.{week_ago}"}),
                "not_onboarded": _count(**{"is_onboarded": "eq.false"}),
                "trial_used":    _count(**{"trial_used": "eq.true"}),
                "by_tier": {t: _count(**{"subscription_tier": f"eq.{t}"})
                            for t in ("free", "daily", "standard", "pro")},
            }
    except Exception as e:
        print(f"⚠️ users_stats: {e}")
        return {"total": 0, "active_7d": 0, "not_onboarded": 0, "trial_used": 0, "by_tier": {}}


@app.get("/admin/users")
async def get_users(
    search: str = "",
    tier: str = "",
    onboarded: str = "",
    confirmed: str = "",
    activity: str = "",
    provider: str = "",
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    page: int = 1,
    per_page: int = 25,
):
    """Paginated, filtered, sorted list of users from profiles table."""
    if not _SB_URL:
        return {"users": [], "total": 0}

    _ALLOWED_SORT = {
        "created_at", "last_active_at", "requests_this_month",
        "total_requests", "session_count", "subscription_tier", "is_beta_tester",
    }
    if sort_by not in _ALLOWED_SORT:
        sort_by = "created_at"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    select_cols = (
        "id,email,full_name,avatar_url,subscription_tier,is_beta_tester,"
        "is_onboarded,email_confirmed,trial_used,"
        "last_active_at,last_city,last_country,last_country_code,"
        "auth_provider,requests_this_month,monthly_limit,bonus_requests,"
        "total_requests,session_count,avg_session_duration,"
        "created_at,last_ip,user_agent,marketing_consent,limit_reset_at,"
        "role,sub_role,segment,ai_personal_prompt"
    )

    params: dict = {
        "select": select_cols,
        "order": f"{sort_by}.{sort_dir}.nullslast",
        "limit": str(per_page),
        "offset": str((page - 1) * per_page),
        "auth_provider": "neq.deleted",
    }

    if search:
        safe = search.replace("*", "").replace("(", "").replace(")", "").replace(";", "")
        params["or"] = f"(email.ilike.*{safe}*,full_name.ilike.*{safe}*)"
    if tier:
        params["subscription_tier"] = f"eq.{tier}"
    if onboarded in ("true", "false"):
        params["is_onboarded"] = f"eq.{onboarded}"
    if confirmed in ("true", "false"):
        params["email_confirmed"] = f"eq.{confirmed}"
    if provider:
        params["auth_provider"] = f"eq.{provider}"

    now = datetime.now(timezone.utc)
    if activity == "today":
        params["last_active_at"] = f"gte.{now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()}"
    elif activity == "7d":
        params["last_active_at"] = f"gte.{(now - timedelta(days=7)).isoformat()}"
    elif activity == "30d":
        params["last_active_at"] = f"gte.{(now - timedelta(days=30)).isoformat()}"
    elif activity == "inactive":
        params["last_active_at"] = f"lt.{(now - timedelta(days=30)).isoformat()}"

    try:
        with httpx.Client(timeout=15) as c:
            hdrs = {**_sb_hdrs(), "Prefer": "count=exact"}
            r = c.get(f"{_SB_URL}/rest/v1/profiles", headers=hdrs, params=params)
            total = 0
            cr = r.headers.get("content-range", "")
            if "/" in cr:
                try:
                    v = cr.split("/")[-1]
                    total = int(v) if v != "*" else 0
                except (ValueError, IndexError):
                    pass
            users = r.json() if r.status_code == 200 else []
            return {"users": users, "total": total}
    except Exception as e:
        print(f"⚠️ get_users: {e}")
        return {"users": [], "total": 0}


# ── /admin/laws ────────────────────────────────────────────────────────────────

@app.get("/admin/laws")
async def get_laws(
    page: int = 1,
    per_page: int = 25,
    search: str | None = None,
    category: str | None = None,
):
    """Список унікальних законів Ради з Qdrant (chunk_index=0)."""
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from qdrant_storage import get_client, RADA_V2_COLLECTIONS

        client = get_client()
        must = [FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        if category:
            must.append(FieldCondition(key="category", match=MatchValue(value=category)))
        scroll_filter = Filter(must=must)

        all_points: list = []
        for col in RADA_V2_COLLECTIONS:
            try:
                next_page_offset = None
                while True:
                    batch, next_page_offset = client.scroll(
                        collection_name=col,
                        scroll_filter=scroll_filter,
                        with_payload=True,
                        limit=1000,
                        offset=next_page_offset,
                    )
                    all_points.extend(batch)
                    if next_page_offset is None:
                        break
            except Exception:
                continue

        if search:
            q = search.strip().lower()
            all_points = [
                p for p in all_points
                if q in (p.payload.get("source") or "").lower()
                or q in (p.payload.get("law_id") or "").lower()
            ]

        total = len(all_points)
        start = (page - 1) * per_page
        page_points = all_points[start: start + per_page]

        laws = [
            {
                "id": str(p.id),
                "content": p.payload.get("content", ""),
                "metadata": {
                    "law_id":      p.payload.get("law_id", ""),
                    "source":      p.payload.get("source", ""),
                    "status":      p.payload.get("status", ""),
                    "law_url":     p.payload.get("law_url", ""),
                    "category":    p.payload.get("category", ""),
                    "chunk_index": p.payload.get("chunk_index", 0),
                    "scraped_at":  p.payload.get("scraped_at", ""),
                },
            }
            for p in page_points
        ]

        return {"total": total, "page": page, "per_page": per_page, "laws": laws}

    except Exception as e:
        raise HTTPException(500, str(e))


# ── /admin/laws/text ──────────────────────────────────────────────────────────

@app.get("/admin/laws/text")
async def get_law_text_endpoint(law_id: str):
    """Повертає повний текст закону з Qdrant (конкатенація всіх чанків)."""
    if not law_id:
        raise HTTPException(400, "law_id required")
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from qdrant_storage import get_client, ALL_V2_COLLECTIONS

        client = get_client()
        all_chunks: list = []
        # Шукаємо по всіх колекціях — law_id унікальний
        for col in ALL_V2_COLLECTIONS:
            try:
                next_page_offset = None
                while True:
                    batch, next_page_offset = client.scroll(
                        collection_name=col,
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
            except Exception:
                continue  # колекція не існує або недоступна — пропускаємо
            if all_chunks:
                break  # знайшли колекцію — далі не шукаємо

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
async def get_base_docs(
    page: int = 1,
    per_page: int = 25,
    source: str | None = None,
    category: str | None = None,
    search: str | None = None,
):
    """Список унікальних документів з Qdrant (chunk_index=0 = один запис на закон)."""
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from qdrant_storage import get_client, RADA_V2_COLLECTIONS, ALL_V2_COLLECTIONS

        client = get_client()

        must = [FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        if category:
            must.append(FieldCondition(key="category", match=MatchValue(value=category)))
        scroll_filter = Filter(must=must)

        # Вибираємо колекції відповідно до фільтру source
        if source == "rada":
            target_cols = RADA_V2_COLLECTIONS
        elif source == "supreme":
            target_cols = ["laws_supreme_v2"]
        elif source == "wiki":
            target_cols = ["laws_wiki_v2"]
        elif source == "ccu":
            target_cols = ["laws_ccu_v2"]
        elif source == "lpd":
            target_cols = ["laws_positions_v2"]
        elif source == "kmu":
            target_cols = ["laws_kmu_v2"]
        elif source == "mod":
            target_cols = ["laws_mod_v2"]
        elif source == "zir":
            target_cols = ["laws_zir_v2"]
        else:
            target_cols = ALL_V2_COLLECTIONS

        all_points: list = []
        for col in target_cols:
            try:
                next_page_offset = None
                while True:
                    batch, next_page_offset = client.scroll(
                        collection_name=col,
                        scroll_filter=scroll_filter,
                        with_payload=True,
                        limit=1000,
                        offset=next_page_offset,
                    )
                    all_points.extend(batch)
                    if next_page_offset is None:
                        break
            except Exception:
                continue  # колекція не існує або недоступна

        # Python-рівень: пошук по назві або law_id (Qdrant не підтримує substring без індексу)
        if search:
            q = search.strip().lower()
            all_points = [
                p for p in all_points
                if q in (p.payload.get("source") or "").lower()
                or q in (p.payload.get("law_id") or "").lower()
            ]

        total = len(all_points)
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


@app.get("/admin/base/categories")
async def get_base_categories():
    """Унікальні категорії з Qdrant для фільтра."""
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue
        from qdrant_storage import get_client, RADA_V2_COLLECTIONS

        client = get_client()
        scroll_filter = Filter(must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))])

        categories: set[str] = set()
        for col in RADA_V2_COLLECTIONS:
          next_page_offset = None
          while True:
            batch, next_page_offset = client.scroll(
                collection_name=col,
                scroll_filter=scroll_filter,
                with_payload=["category"],
                limit=1000,
                offset=next_page_offset,
            )
            for p in batch:
                cat = (p.payload or {}).get("category", "")
                if cat:
                    categories.add(cat)
            if next_page_offset is None:
                break

        return sorted(categories)

    except Exception as e:
        raise HTTPException(500, str(e))


# ── /admin/sync/stats — аналітика надійності автосинхронізації ───────────────

@app.get("/admin/sync/stats")
async def get_sync_stats():
    """Надійність, sparkline і алерти для дашборда та сторінки синхронізації."""
    import httpx as _httpx

    now = datetime.now(timezone.utc)
    month_ago = (now - timedelta(days=30)).isoformat()
    week_ago  = (now - timedelta(days=7)).isoformat()

    # Останні 100 запусків за 30 днів
    try:
        r = _httpx.get(
            f"{_SB_URL}/rest/v1/sync_logs",
            params={"started_at": f"gte.{month_ago}", "order": "started_at.desc", "limit": "100"},
            headers={**_sb_hdrs(), "Prefer": "return=representation"},
            timeout=8,
        )
        all_logs = r.json() if r.status_code == 200 else []
    except Exception:
        all_logs = []

    terminal = [l for l in all_logs if l.get("status") in ("success", "error", "paused")]
    running_logs = [l for l in all_logs if l.get("status") == "running"]

    # ── Надійність ─────────────────────────────────────────────────────────────
    total   = len(terminal)
    success = sum(1 for l in terminal if l["status"] == "success")
    errors  = sum(1 for l in terminal if l["status"] == "error")
    paused  = sum(1 for l in terminal if l["status"] == "paused")
    pct     = round(success / total * 100, 1) if total > 0 else None

    # ── Закони (включаємо running — реальний прогрес з in-memory лічильника) ───
    laws_30d = sum(l.get("laws_processed") or 0 for l in terminal)
    laws_7d  = sum(l.get("laws_processed") or 0 for l in terminal
                   if (l.get("started_at") or "") >= week_ago)

    # Додаємо законів з поточних running-сесій (з in-memory _sync)
    currently_running = []
    for src in _SOURCES:
        if _sync.get(src, {}).get("running"):
            in_mem = _sync[src].get("laws_processed", 0)
            sid = _sync[src].get("session_id", "")
            # Шукаємо відповідний running_log щоб взяти started_at
            rl = next((l for l in running_logs if l.get("session_id") == sid), None)
            started_at = rl.get("started_at") if rl else None
            # Береємо більше між Supabase і in-memory
            sb_laws = rl.get("laws_processed") or 0 if rl else 0
            live_laws = max(in_mem, sb_laws)
            if started_at and started_at >= week_ago:
                laws_7d += live_laws
            laws_30d += live_laws
            currently_running.append({
                "source": src,
                "laws_processed": live_laws,
                "started_at": started_at,
            })

    # ── Середня тривалість (успішні) ───────────────────────────────────────────
    durations: list[float] = []
    for l in terminal:
        if l["status"] == "success" and l.get("started_at") and l.get("finished_at"):
            try:
                s = datetime.fromisoformat(l["started_at"].replace("Z", "+00:00"))
                f = datetime.fromisoformat(l["finished_at"].replace("Z", "+00:00"))
                durations.append((f - s).total_seconds())
            except Exception:
                pass
    avg_duration = round(sum(durations) / len(durations)) if durations else None

    # ── Серія провалів ─────────────────────────────────────────────────────────
    consecutive_failures = 0
    for l in terminal:
        if l["status"] == "error":
            consecutive_failures += 1
        else:
            break

    last_success = next((l for l in terminal if l["status"] == "success"), None)
    last_failure = next((l for l in terminal if l["status"] == "error"),   None)

    # ── Sparkline: останні 14 запусків + поточні running (найстаріший → найновіший) ──
    sparkline_src = (running_logs + terminal)[:14]  # running — найновіші, йдуть першими
    last_14: list[dict] = []
    for l in sparkline_src:
        dur = None
        try:
            s = datetime.fromisoformat(l["started_at"].replace("Z", "+00:00")) if l.get("started_at") else None
            if s:
                if l.get("finished_at"):
                    f = datetime.fromisoformat(l["finished_at"].replace("Z", "+00:00"))
                    dur = round((f - s).total_seconds())
                elif l.get("status") == "running":
                    # Для поточного запуску — тривалість до зараз
                    dur = round((now - s).total_seconds())
        except Exception:
            pass
        # Для running — laws_processed беремо з in-memory якщо більше
        laws_val = l.get("laws_processed") or 0
        if l.get("status") == "running":
            src_name = l.get("source", "")
            in_mem = _sync.get(src_name, {}).get("laws_processed", 0)
            laws_val = max(laws_val, in_mem)
        last_14.append({
            "status":         l["status"],
            "laws_processed": laws_val,
            "duration_sec":   dur,
            "started_at":     l.get("started_at"),
            "source":         l.get("source"),
        })
    last_14.reverse()

    # ── Алерти ─────────────────────────────────────────────────────────────────
    alerts: list[dict] = []
    if consecutive_failures >= 3:
        alerts.append({"level": "error", "message": f"{consecutive_failures} провали поспіль — перевірте логи синхронізації"})
    elif consecutive_failures == 1:
        alerts.append({"level": "warning", "message": "Останній запуск завершився помилкою"})

    if last_success and last_success.get("finished_at"):
        try:
            fin = datetime.fromisoformat(last_success["finished_at"].replace("Z", "+00:00"))
            days_since = (now - fin).days
            if days_since >= 7:
                alerts.append({"level": "error", "message": f"База не оновлювалась {days_since} днів!"})
            elif days_since >= 3:
                alerts.append({"level": "warning", "message": f"База не оновлювалась {days_since} дні"})
        except Exception:
            pass
    elif not last_success and total > 0:
        alerts.append({"level": "error", "message": "Жодної успішної синхронізації за 30 днів"})

    if not any(a["level"] == "error" for a in alerts):
        last5 = terminal[:5]
        if len(last5) == 5 and all((l.get("laws_processed") or 0) == 0 for l in last5):
            alerts.append({"level": "info", "message": "База актуальна — нових законів не з'явилось"})

    return {
        "reliability_30d": {"total": total, "success": success, "error": errors, "paused": paused, "pct": pct},
        "laws_30d":              laws_30d,
        "laws_7d":               laws_7d,
        "avg_duration_sec":      avg_duration,
        "consecutive_failures":  consecutive_failures,
        "currently_running":     currently_running,
        "last_success_at":       last_success.get("finished_at") if last_success else None,
        "last_failure_at":       last_failure.get("finished_at") if last_failure else None,
        "last_14_runs":          last_14,
        "alerts":                alerts,
    }


# ── /admin/rada/coverage — покриття бази знань по розділах ────────────────────

# Кеш Ради (щоб не довбати сайт при кожному запиті)
_rada_totals_cache: dict[str, int] = {}    # code -> total_docs_on_rada
_rada_estimated_cache: dict[str, bool] = {}  # code -> True якщо число-оцінка (pages*50)
_rada_cache_time: float = 0.0
_RADA_CACHE_TTL = 24 * 60 * 60  # 24 год


@app.get("/admin/rada/coverage")
async def get_rada_coverage(refresh: bool = False):
    """
    Покриття бази знань: для кожного розділу Ради порівнює
    кількість документів на сайті vs у нас в Qdrant.
    Повертає масив секцій з health-індикатором.
    """
    import asyncio as _asyncio
    import time as _time
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    from qdrant_storage import get_client, RADA_V2_COLLECTIONS
    from rada_scanner import ALL_THEMES, get_section_doc_count

    # ── 1. Qdrant: збираємо chunk_index=0 по всіх РАДА-колекціях ──
    client = get_client()
    qdrant_filter = Filter(must=[
        FieldCondition(key="chunk_index", match=MatchValue(value=0)),
    ])

    all_points: list = []
    for col in RADA_V2_COLLECTIONS:
        next_offset = None
        while True:
            batch, next_offset = client.scroll(
                collection_name=col,
                scroll_filter=qdrant_filter,
                with_payload=["category", "status", "scraped_at"],
                limit=2000,
                offset=next_offset,
            )
            all_points.extend(batch)
            if next_offset is None:
                break

    # Групуємо по category
    qdrant: dict[str, dict] = {}
    for p in all_points:
        cat = (p.payload or {}).get("category", "")
        if not cat:
            continue
        if cat not in qdrant:
            qdrant[cat] = {"total": 0, "restricted": 0, "last_scraped_at": None}
        qdrant[cat]["total"] += 1
        if (p.payload or {}).get("status") == "ДСК":
            qdrant[cat]["restricted"] += 1
        sat = (p.payload or {}).get("scraped_at")
        if sat and (not qdrant[cat]["last_scraped_at"] or sat > qdrant[cat]["last_scraped_at"]):
            qdrant[cat]["last_scraped_at"] = sat

    # ── 2. Rada totals — з кешу або свіжий запит ──────────────────────────
    global _rada_totals_cache, _rada_estimated_cache, _rada_cache_time
    now = _time.time()
    if refresh or not _rada_totals_cache or (now - _rada_cache_time) > _RADA_CACHE_TTL:
        # Паралельний запит до Ради (max 5 одночасно)
        sem = _asyncio.Semaphore(5)
        async def _fetch(code: str) -> tuple[str, int, bool]:
            async with sem:
                exact, _, is_exact = await _asyncio.to_thread(get_section_doc_count, code)
                return code, exact, is_exact
        results = await _asyncio.gather(*[_fetch(code) for code, _ in ALL_THEMES])
        _rada_totals_cache      = {code: cnt  for code, cnt, _  in results}
        _rada_estimated_cache   = {code: not is_ex for code, _, is_ex in results}
        _rada_cache_time = now

    # ── 3. Останній синк Ради з sync_logs ─────────────────────────────────
    last_sync_at: str | None = None
    try:
        import httpx as _httpx
        r = _httpx.get(
            f"{_SB_URL}/rest/v1/sync_logs",
            params={"source": "eq.rada", "order": "finished_at.desc", "limit": "1"},
            headers={**_sb_hdrs(), "Prefer": "return=representation"},
            timeout=5,
        )
        rows = r.json()
        if rows:
            last_sync_at = rows[0].get("finished_at")
    except Exception:
        pass

    # ── 4. Будуємо відповідь ───────────────────────────────────────────────
    sections = []
    for code, label in ALL_THEMES:
        our  = qdrant.get(code, {"total": 0, "restricted": 0, "last_scraped_at": None})
        rada = _rada_totals_cache.get(code)

        our_total      = our["total"]
        our_restricted = our["restricted"]
        our_public     = our_total - our_restricted

        coverage_pct: float | None = None
        if rada and rada > 0:
            coverage_pct = round(our_total / rada * 100, 1)

        # Колір здоров'я
        if coverage_pct is None:
            health = "unknown"
        elif coverage_pct >= 80:
            health = "good"
        elif coverage_pct >= 40:
            health = "warning"
        else:
            health = "critical"

        sections.append({
            "code":            code,
            "label":           label,
            "rada_total":      rada,
            "rada_estimated":  _rada_estimated_cache.get(code, True),
            "our_total":       our_total,
            "our_restricted":  our_restricted,
            "our_public":      our_public,
            "coverage_pct":    coverage_pct,
            "last_scraped_at": our["last_scraped_at"],
            "health":          health,
        })

    # ── 5. Інші джерела (КСУ, Вікі, Верховний суд) ───────────────────────────
    NON_RADA_COLS = [
        ("laws_positions_v2", "Правові позиції Верховного Суду", "lpd"),
        ("laws_ccu_v2",       "Конституційний суд України",      "ccu"),
        ("laws_wiki_v2",      "Вікіпедія — правові статті",      "wiki"),
        ("laws_supreme_v2",   "Верховний суд України",            "supreme"),
        ("laws_kmu_v2",       "Кабінет Міністрів України",        "kmu"),
        ("laws_mod_v2",       "Міністерство оборони України",     "mod"),
        ("laws_zir_v2",       "Зведений інформаційний реєстр ДПС","zir"),
    ]
    other_sources = []
    for col_name, col_label, sync_src in NON_RADA_COLS:
        try:
            cnt = client.count(
                collection_name=col_name,
                count_filter=Filter(
                    must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
                ),
                exact=True,
            ).count or 0
        except Exception:
            cnt = 0

        # Остання дата скрапінгу — беремо максимум scraped_at
        last_sat: str | None = None
        try:
            chunk_pts, _ = client.scroll(
                collection_name=col_name,
                scroll_filter=Filter(
                    must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
                ),
                with_payload=["scraped_at"],
                limit=1000,
            )
            for pt in chunk_pts:
                sat = (pt.payload or {}).get("scraped_at")
                if sat and (not last_sat or sat > last_sat):
                    last_sat = sat
        except Exception:
            pass

        # Last sync з sync_logs
        src_last_sync: str | None = None
        try:
            import httpx as _httpx2
            r2 = _httpx2.get(
                f"{_SB_URL}/rest/v1/sync_logs",
                params={"source": f"eq.{sync_src}", "order": "finished_at.desc", "limit": "1"},
                headers={**_sb_hdrs(), "Prefer": "return=representation"},
                timeout=5,
            )
            rows2 = r2.json()
            if rows2:
                src_last_sync = rows2[0].get("finished_at")
        except Exception:
            pass

        # Health: спираємось на вік останнього скрапінгу
        if cnt == 0:
            col_health = "critical"
        elif last_sat:
            try:
                last_dt = datetime.fromisoformat(last_sat.replace("Z", "+00:00"))
                age_days = (datetime.now(timezone.utc) - last_dt).days
                col_health = "good" if age_days < 30 else "warning" if age_days < 90 else "critical"
            except Exception:
                col_health = "unknown"
        else:
            col_health = "unknown"

        other_sources.append({
            "id":              col_name,
            "label":           col_label,
            "our_total":       cnt,
            "last_scraped_at": last_sat,
            "last_sync_at":    src_last_sync,
            "health":          col_health,
        })

    return {
        "sections":      sections,
        "other_sources": other_sources,
        "last_sync_at":  last_sync_at,
        "cache_age_sec": int(now - _rada_cache_time) if _rada_cache_time else None,
    }


# ── Centroid-based collection router ──────────────────────────────────────────
#
# Routing без жодного хардкоду: для кожної колекції Qdrant обчислюємо
# centroid — середній вектор по вибірці реальних документів.
# Зберігаємо у collection_centroids.json; при /ask — dot product з query_vector.
#
# Перебудова: POST /admin/rebuild-centroids (після великого синку).

_CENTROID_FILE = BASE_DIR / "collection_centroids.json"
_CENTROID_SAMPLE = 300   # векторів на колекцію для апроксимації центроїду
_ALWAYS_INCLUDE = {"laws_positions_v2", "laws_supreme_v2", "laws_kmu_v2"}

_centroids: dict[str, list[float]] = {}
_centroids_lock = threading.Lock()
_centroid_building = False  # прапор: rebuild виконується прямо зараз


def _compute_centroids(collections: list[str]) -> dict[str, list[float]]:
    """
    Для кожної колекції зчитує до _CENTROID_SAMPLE векторів і повертає mean vector.
    Зберігає у файл разом з метаданими (час, кількість векторів).
    Sequential — простіше дебажити, уникаємо проблем з вкладеними thread pool.
    """
    import json as _json
    from datetime import timezone
    from qdrant_storage import get_client

    client = get_client()
    centroids: dict[str, list[float]] = {}
    counts: dict[str, int] = {}

    logger.info(f"CENTROID ⏳ Building centroids for {len(collections)} collections...")

    for coll in collections:
        try:
            points, _ = client.scroll(
                collection_name=coll,
                with_vectors=True,
                with_payload=False,
                limit=_CENTROID_SAMPLE,
            )
            if not points:
                logger.info(f"CENTROID ⚠️ {coll}: empty collection, skipping")
                continue

            # p.vector може бути list або dict залежно від версії qdrant_client
            raw_vecs = []
            for p in points:
                v = p.vector
                if v is None:
                    continue
                if isinstance(v, dict):
                    v = next(iter(v.values()), None)
                if v is not None:
                    raw_vecs.append(list(v))

            if not raw_vecs:
                logger.info(f"CENTROID ⚠️ {coll}: no valid vectors found")
                continue

            n = len(raw_vecs)
            dim = len(raw_vecs[0])
            centroid = [sum(v[i] for v in raw_vecs) / n for i in range(dim)]
            centroids[coll] = centroid
            counts[coll] = n
            logger.info(f"CENTROID ✅ {coll}: {n} vectors, dim={dim}")

        except Exception as e:
            logger.info(f"CENTROID ❌ {coll}: {type(e).__name__}: {e}")

    # Зберігаємо у файл: вектори + метадані під ключем __meta__
    payload: dict = dict(centroids)
    payload["__meta__"] = {
        "built_at": datetime.now(timezone.utc).isoformat(),
        "sample_size": _CENTROID_SAMPLE,
        "counts": counts,
    }
    _CENTROID_FILE.write_text(_json.dumps(payload))
    logger.info(f"CENTROID ✅ Saved {len(centroids)}/{len(collections)} collections to file")

    return centroids


def _load_centroids() -> dict[str, list[float]]:
    """Завантажує центроїди з файлу або будує їх з Qdrant (перший запуск)."""
    global _centroids
    if _centroids:
        return _centroids
    with _centroids_lock:
        if _centroids:
            return _centroids

        if _CENTROID_FILE.exists():
            import json as _json
            raw = _json.loads(_CENTROID_FILE.read_text())
            # Відфільтровуємо __meta__ — це не вектор
            _centroids = {k: v for k, v in raw.items() if k != "__meta__"}
            logger.info(f"CENTROID ✅ Centroid router: loaded {len(_centroids)} collections from file")
        else:
            logger.info("CENTROID ⏳ Centroid router: building from Qdrant (one-time, ~10s)...")
            from qdrant_storage import ALL_V2_COLLECTIONS
            _centroids = _compute_centroids(ALL_V2_COLLECTIONS)

        return _centroids


def _centroid_status() -> dict:
    """Повертає метадані з файлу центроїдів або повідомляє що файл відсутній."""
    base = {"building": _centroid_building}
    if not _CENTROID_FILE.exists():
        return {**base, "ready": False}
    try:
        import json as _json
        raw = _json.loads(_CENTROID_FILE.read_text())
        meta = raw.get("__meta__", {})
        return {
            **base,
            "ready": True,
            "built_at": meta.get("built_at"),
            "sample_size": meta.get("sample_size", _CENTROID_SAMPLE),
            "collections": {k: v for k, v in meta.get("counts", {}).items()},
            "total_collections": len([k for k in raw if k != "__meta__"]),
        }
    except Exception as e:
        return {**base, "ready": False, "error": str(e)}


def _cosine_sim(a: list[float], b: list[float]) -> float:
    import math
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def _route_collections(
    question: str,
    all_collections: list[str],
    query_vector: list[float] | None = None,
) -> list[str]:
    """
    Centroid routing: cosine similarity між query_vector і центроїдом кожної колекції.

    Завжди: laws_positions, laws_supreme, laws_kmu.
    Додатково: колекції з score ≥ 85% від максимального І ≥ абсолютного порогу.
    Fallback → all_collections (ALL_V2_COLLECTIONS) якщо центроїди недоступні.
    """
    try:
        centroids = _load_centroids()
        if not centroids:
            return list(all_collections)

        if query_vector is None:
            import embed_v2 as _embed_v2
            q_vec = _embed_v2.embed_query(question)
        else:
            q_vec = query_vector

        # Рахуємо тільки по колекціях, для яких є центроїд
        # (виключаємо always-included щоб не впливали на відносний поріг)
        optional = {c: v for c, v in centroids.items() if c not in _ALWAYS_INCLUDE}
        scores: dict[str, float] = {
            coll: _cosine_sim(q_vec, vec) for coll, vec in optional.items()
        }

        if scores:
            max_score = max(scores.values())
            top = max(scores, key=scores.__getitem__)

            # 75% відносний + 0.45 абсолютний поріг; max 5 доменних колекцій
            RELATIVE, ABSOLUTE, MAX_COLS = 0.75, 0.45, 5
            selected = {
                c for c, s in scores.items()
                if s >= max_score * RELATIVE and s >= ABSOLUTE
            }
            if len(selected) > MAX_COLS:
                selected = set(sorted(selected, key=scores.__getitem__, reverse=True)[:MAX_COLS])

            logger.info(f"CENTROID 🧭 Routing → {sorted(_ALWAYS_INCLUDE | selected)} [top: {top} = {max_score:.3f}]")
        else:
            selected = set()

        result = _ALWAYS_INCLUDE | selected
        return [c for c in all_collections if c in result]

    except Exception as e:
        logger.info(f"CENTROID ⚠️ Centroid routing failed ({e}), fallback → all collections")
        return list(all_collections)


# ── Intent classifier → вибір колекцій ───────────────────────────────────────

async def _classify_and_route(question: str, all_cols: list[str], model_name: str = "", query_vector: list | None = None) -> list[str]:
    """Динамічний роутинг: probe по всіх доступних колекціях.
    Rada має багато доменних колекцій, тому обмежуємо саме їх. Окремі джерела
    (КМУ, wiki, суди, КСУ, MOD, ZIR) не повинні випадати лише через top-N cutoff."""
    import asyncio as _asyncio
    from qdrant_storage import _search_single as _qdrant_search_single

    if query_vector is None:
        logger.info("ROUTING: no vector → all collections")
        return all_cols

    _always_include = {"laws_kmu_v2", "laws_positions_v2", "laws_supreme_v2"}
    _rada_prefix = "rada_"
    _single_source_cols = {
        "laws_kmu_v2", "laws_wiki_v2", "laws_ccu_v2", "laws_positions_v2",
        "laws_supreme_v2", "laws_mod_v2", "laws_zir_v2",
    }

    async def _probe(col: str) -> tuple[str, float]:
        try:
            hits = await _asyncio.to_thread(
                _qdrant_search_single,
                col,
                query_vector,
                1,    # top_k=1
                0.0,  # threshold=0.0 — хочемо будь-який результат
            )
            score = hits[0]["similarity"] if hits else 0.0
            return col, score
        except Exception as e:
            logger.warning("PROBE %s failed: %s", col, e)
            return col, 0.0

    probes: list[tuple[str, float]] = await _asyncio.gather(*[_probe(c) for c in all_cols])
    probes.sort(key=lambda x: x[1], reverse=True)
    logger.info("PROBE: %s", [(c, round(s, 3)) for c, s in probes])

    max_score = probes[0][1] if probes else 0.0
    aux_floor = max(0.50, max_score - 0.08)
    rada_floor = max(0.50, max_score - 0.06)
    max_rada_cols = int(settings_cache.get_float("routing_max_rada_cols", 5))

    chosen: list[str] = []

    rada_candidates = [
        (col, score) for col, score in probes
        if col.startswith(_rada_prefix) and score >= rada_floor
    ]
    if not rada_candidates:
        rada_candidates = [
            (col, score) for col, score in probes
            if col.startswith(_rada_prefix)
        ][:max(2, max_rada_cols)]
    chosen.extend(col for col, _ in rada_candidates[:max_rada_cols])

    for col, score in probes:
        if col in _single_source_cols and score >= aux_floor:
            chosen.append(col)

    for _always in _always_include:
        if _always in all_cols and _always not in chosen:
            chosen.append(_always)

    chosen = [c for c in dict.fromkeys(chosen) if c in all_cols]
    if len(chosen) < 3:
        chosen = [col for col, _ in probes[:3]]

    logger.info("ROUTING → %s", chosen)
    return chosen


# ── /ask — основний чат-ендпоінт ──────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    max_docs: int = 12                         # max chunks from Qdrant (from user's plan)
    filter_domains: list[str] | None = None    # kept for backward compat (unused)
    filter_sources: list[str] | None = None    # e.g. ["rada", "wiki", "supreme", "ccu"]
    response_features: list[str] = []          # enabled response quality features from plan
    user_profile: dict | None = None           # {role, sub_role, segment} from onboarding
    history: list[dict] | None = None          # [{role:"user"|"assistant", content:"..."}]
    context_summary: str | None = None         # compressed summary of older turns (generated every 3rd turn)
    ai_personal_prompt: str | None = None      # персональний AI-профіль юзера (з налаштувань)
    response_length_pref: str = "standard"     # short|standard|detailed|full (gated by plan on frontend)
    response_lang_style: str = "legal"         # legal|plain (gated by plan on frontend)


class GenerateUserPromptRequest(BaseModel):
    role: str | None = None
    sub_role: list[str] = []
    segment: list[str] = []


_CLF_FALLBACK = {"sentiment": "neutral", "complexity_score": 1, "user_intent": "консультація"}


_QUERY_STOPWORDS = {
    "дай", "дайте", "надай", "надайте", "інфо", "інформацію", "інформація",
    "щодо", "стосовно", "про", "по", "для", "при", "або", "или", "та", "і",
    "й", "в", "у", "на", "з", "із", "від", "до", "як", "які", "який", "яка",
    "это", "це", "ця", "цей", "вони", "воно", "там", "так", "само", "тому",
}


def _query_terms(text: str, limit: int = 24) -> list[str]:
    terms: list[str] = []
    for raw in re.findall(r"[\w'-]+", (text or "").lower()):
        if len(raw) < 4 or raw in _QUERY_STOPWORDS:
            continue
        terms.append(raw)
        lemma = _ua_lemma(raw)
        if lemma and lemma not in _QUERY_STOPWORDS:
            terms.append(lemma)
    return list(dict.fromkeys(terms))[:limit]


def _last_user_question(history: list[dict] | None) -> str:
    if not history:
        return ""
    for turn in reversed(history):
        if turn.get("role") == "user":
            content = (turn.get("content") or "").strip()
            if content:
                return content[:600]
    return ""


def _looks_like_followup(text: str) -> bool:
    q = (text or "").strip().lower()
    if not q:
        return False
    words = re.findall(r"[\w'-]+", q)
    if len(words) <= 7:
        return True
    return any(marker in q for marker in (" це ", " цей ", " ця ", " ті ", " вони ", " так само", "а для "))


def _term_overlap_score(result: dict, terms: list[str]) -> int:
    meta = result.get("out_metadata", {})
    haystack = (
        (meta.get("source") or "") + " " +
        (meta.get("title") or "") + " " +
        (result.get("out_content") or "")
    ).lower()
    return sum(1 for term in terms if term in haystack)


def _authority_score(result: dict) -> float:
    col = result.get("_collection", "")
    meta = result.get("out_metadata", {})
    doc_type = meta.get("rada_doc_type") or meta.get("doc_type", "")

    score = 1.0
    if col == "laws_kmu_v2":
        score = 1.18
    elif col.startswith("rada_"):
        score = 1.12
    elif col in ("laws_positions_v2", "laws_supreme_v2", "laws_ccu_v2"):
        score = 1.03
    elif col == "laws_zir_v2":
        score = 0.96
    elif col == "laws_wiki_v2":
        score = 0.90

    type_boost = {
        "Кодекс": 0.08,
        "Закон": 0.07,
        "Постанова": 0.06,
        "Наказ": 0.04,
        "Розпорядження": 0.03,
        "Лист": -0.08,
        "Роз'яснення": -0.05,
        "Інформаційний лист": -0.08,
    }.get(doc_type, 0.0)
    return score + type_boost


def _text_quality_score(text: str) -> float:
    """Cheap language/noise signal: penalize chunks where Cyrillic legal text is drowned by garbage."""
    letters = re.findall(r"[A-Za-zА-Яа-яІіЇїЄєҐґ]", text or "")
    if len(letters) < 80:
        return 0.85
    cyr = sum(1 for ch in letters if re.match(r"[А-Яа-яІіЇїЄєҐґ]", ch))
    ratio = cyr / max(len(letters), 1)
    if ratio >= 0.72:
        return 1.0
    if ratio >= 0.55:
        return 0.82
    return 0.55


def _answerability_score(result: dict, query_text: str, terms: list[str] | None = None) -> dict:
    """
    Universal deterministic reranker.

    Similarity only says "same topic"; answerability asks whether this chunk is likely to
    contain a usable legal answer to the exact question.
    """
    terms = terms or _query_terms(query_text, limit=18)
    meta = result.get("out_metadata", {})
    title = f"{meta.get('source') or ''} {meta.get('title') or ''}".lower()
    content = (result.get("out_content") or "").lower()
    haystack = f"{title} {content}"

    matched_terms = [t for t in terms if t in haystack]
    content_terms = [t for t in terms if t in content]
    title_terms = [t for t in terms if t in title]
    coverage = len(set(matched_terms)) / max(len(terms), 1)
    content_coverage = len(set(content_terms)) / max(len(terms), 1)

    normative_markers = (
        "зобов", "повинен", "повинн", "має право", "не має права",
        "підляга", "не підляга", "встановлю", "визнача", "передбач",
        "відповідно до", "згідно", "пункт", "статт", "частин",
        "закон", "постанова", "наказ", "порядок", "положення",
    )
    has_normative = any(marker in content for marker in normative_markers)

    col = result.get("_collection", "")
    source_penalty = 0.0
    if col == "laws_wiki_v2":
        source_penalty += 0.12
    elif col == "laws_supreme_v2":
        source_penalty += 0.06

    quality = _text_quality_score(result.get("out_content") or "")
    quality_penalty = (1.0 - quality) * 0.35

    sim = float(result.get("similarity", 0.0) or 0.0)
    score = (
        sim * 0.34
        + coverage * 0.34
        + content_coverage * 0.18
        + min(len(set(title_terms)), 3) * 0.025
        + (_authority_score(result) - 1.0) * 0.10
        + (0.06 if has_normative else 0.0)
        - source_penalty
        - quality_penalty
    )

    result["_answerability"] = {
        "score": round(score, 4),
        "coverage": round(coverage, 3),
        "content_coverage": round(content_coverage, 3),
        "matched": matched_terms[:10],
        "quality": round(quality, 3),
        "normative": has_normative,
    }
    return result["_answerability"]


def _rerank_by_answerability(results: list[dict], query_text: str, max_docs: int, *, keep_weak: bool = False) -> list[dict]:
    terms = _query_terms(query_text, limit=18)
    if len(terms) < 2 or not results:
        return results[:max_docs]

    scored: list[tuple[float, dict]] = []
    for r in results:
        ans = _answerability_score(r, query_text, terms)
        coverage = ans["coverage"]
        # Keep low-coverage chunks only when they are protected structural chunks
        # from a selected document, or when we are in weak-search mode and need
        # Gemini to explain what was found.
        protected = bool(r.get("_full_law") or r.get("_doc_expansion"))
        if not keep_weak and coverage < 0.12 and not protected:
            continue
        scored.append((ans["score"], r))

    if not scored:
        return results[:max_docs]

    scored.sort(
        key=lambda item: (
            item[0],
            item[1]["_answerability"]["coverage"],
            _authority_score(item[1]),
            item[1].get("similarity", 0.0),
        ),
        reverse=True,
    )

    picked: list[dict] = []
    per_doc: dict[tuple[str, str], int] = {}
    wiki_count = 0
    for _, r in scored:
        col = r.get("_collection", "")
        if col == "laws_wiki_v2":
            if wiki_count >= max(1, max_docs // 5):
                continue
            wiki_count += 1
        doc_key = (col, r["out_metadata"].get("law_id", ""))
        doc_cap = 4 if r.get("_full_law") else 2
        if per_doc.get(doc_key, 0) >= doc_cap:
            continue
        picked.append(r)
        per_doc[doc_key] = per_doc.get(doc_key, 0) + 1
        if len(picked) >= max_docs:
            break

    logger.info(
        "ANSWERABILITY RERANK: in=%d out=%d top=%s terms=%s",
        len(results),
        len(picked),
        [
            f"{r.get('_collection')}:{r['out_metadata'].get('law_id','?')}:a={r.get('_answerability',{}).get('score')}:cov={r.get('_answerability',{}).get('coverage')}"
            for r in picked[:6]
        ],
        terms[:10],
    )
    return picked or results[:max_docs]


def _prefer_term_matched_results(results: list[dict], query_text: str, max_docs: int) -> list[dict]:
    terms = _query_terms(query_text)
    if len(terms) < 2:
        return results[:max_docs]

    scored = [(_term_overlap_score(r, terms), r) for r in results]
    matched = [(score, r) for score, r in scored if score > 0]
    if len(matched) < 2:
        return results[:max_docs]

    matched.sort(
        key=lambda item: (
            item[0],
            _authority_score(item[1]),
            item[1].get("similarity", 0.0),
        ),
        reverse=True,
    )
    matched_rows = [r for _, r in matched]
    matched_keys = {
        (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
        for r in matched_rows
    }
    remainder = [
        r for _, r in scored
        if (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index")) not in matched_keys
    ]
    reranked = (matched_rows + remainder)[:max_docs]
    logger.info(
        "TERM RERANK: matched=%d total=%d terms=%s",
        len(matched_rows),
        len(reranked),
        terms[:10],
    )
    return reranked


def _citations_used_in_answer(answer: str, citations: list[dict]) -> list[dict]:
    used: set[int] = set()
    for group in re.findall(r"\[([\d,\s]+)\]", answer or ""):
        used.update(int(n) for n in re.findall(r"\d+", group))
    if not used:
        return citations
    filtered = [c for c in citations if int(c.get("num", 0) or 0) in used]
    return filtered or citations


def _finish_reason_is_max_tokens(finish_reason) -> bool:
    return str(finish_reason) in ("FinishReason.MAX_TOKENS", "MAX_TOKENS", "2")


def _answer_looks_incomplete(answer: str) -> bool:
    text = (answer or "").strip()
    if len(text) < 20:
        return False
    if text[-1] in ".!?…]»)\"'":
        return False
    tail = text[-80:].lower()
    dangling_words = (
        " та", " і", " або", " але", " якщо", " що", " який", " яка", " які",
        " на", " у", " в", " до", " від", " за", " про", " при", " для", " щодо",
    )
    return True if any(tail.endswith(w) for w in dangling_words) else True


async def _complete_answer_if_needed(pipe: dict, answer: str, finish_reason=None) -> str:
    if not (_finish_reason_is_max_tokens(finish_reason) or _answer_looks_incomplete(answer)):
        return answer

    import asyncio as _asyncio
    from vertexai.generative_models import GenerationConfig

    completed = answer
    try:
        for attempt in range(2):
            continuation_prompt = (
                "Попередня відповідь обірвалася. Допиши ТІЛЬКИ продовження з місця обриву. "
                "Не повторюй уже написаний текст, не починай заново, не додавай нові великі розділи. "
                "Дай 1-3 короткі речення або заверши поточний пункт. Обов'язково закінчи завершеним реченням. "
                "Якщо останнє слово обрізане, почни з решти цього слова. "
                "Якщо потрібне юридичне посилання, використовуй той самий формат [N].\n\n"
                "Обрізана відповідь:\n"
                f"{completed[-2500:]}"
            )
            cfg = GenerationConfig(temperature=0.0, max_output_tokens=700)
            resp = await _asyncio.wait_for(
                _asyncio.to_thread(pipe["main_model"].generate_content, continuation_prompt, generation_config=cfg),
                timeout=20,
            )
            continuation = (resp.text or "").strip()
            if not continuation:
                break
            joiner = "" if completed.rstrip() and completed.rstrip()[-1].isalnum() and continuation[0].isalnum() else " "
            completed = completed.rstrip() + joiner + continuation
            logger.info("ANSWER CONTINUATION: attempt=%d appended %d chars", attempt + 1, len(continuation))
            cont_finish_reason = None
            try:
                cont_finish_reason = resp.candidates[0].finish_reason
            except Exception:
                pass
            if not (_finish_reason_is_max_tokens(cont_finish_reason) or _answer_looks_incomplete(completed)):
                break
        return completed
    except Exception as e:
        logger.warning("ANSWER CONTINUATION failed: %s", e)
    return completed


async def _ask_pipeline(body: AskRequest) -> dict:
    """Retrieval → rerank → context → prompt building. Повертає dict для /ask і /ask_stream."""
    import asyncio as _asyncio

    start_time = time.time()
    question = body.question.strip()
    if not question:
        raise HTTPException(400, "question is required")

    # 1. Ініціалізація + embed query + HyDE гіпотетична відповідь (паралельно)
    try:
        import embed_v2 as _embed_v2
        from vertexai.generative_models import GenerativeModel, GenerationConfig
        import json as _json

        if not _vertex_initialized:
            _init_vertex_ai()

        _model_name = settings_cache.get("ai_model")

        # Визначаємо мову запиту та перекладаємо якщо потрібно
        def _is_russian(text: str) -> bool:
            russian_only = set("ыъэ")
            ukrainian_only = set("іїєґ")
            t = text.lower()
            return any(c in russian_only for c in t) and not any(c in ukrainian_only for c in t)

        search_question = question  # текст для embedding/пошуку
        if _is_russian(question):
            try:
                _tr_model = GenerativeModel(_model_name)
                try:
                    from vertexai.generative_models import ThinkingConfig as _TrThinkingConfig
                    _tr_gen_cfg = GenerationConfig(
                        temperature=0.0, max_output_tokens=800,
                        thinking_config=_TrThinkingConfig(thinking_budget=0),
                    )
                except Exception:
                    _tr_gen_cfg = GenerationConfig(temperature=0.0, max_output_tokens=800)
                _tr_resp = await _asyncio.wait_for(
                    _asyncio.to_thread(
                        _tr_model.generate_content,
                        (
                            "Переклади на українську мову точно і повністю. "
                            "Зберігай усі ключові слова: назви країн, юридичні терміни, "
                            "специфічні поняття (навіть розмовні скорочення). "
                            "Наприклад: 'загран командировок' → 'закордонних відряджень'. "
                            "Відповідь — тільки переклад без пояснень:\n\n"
                            f"{question}"
                        ),
                        generation_config=_tr_gen_cfg,
                    ),
                    timeout=15.0,
                )
                _tr_text = ""
                try:
                    _tr_text = _tr_resp.text.strip()
                except Exception:
                    pass
                if not _tr_text:
                    try:
                        _tr_text = " ".join(
                            getattr(_p, "text", "").strip()
                            for _p in _tr_resp.candidates[0].content.parts
                            if not getattr(_p, "thought", False) and getattr(_p, "text", "")
                        ).strip()
                    except Exception:
                        pass
                try:
                    _tr_parts = [(getattr(_p, "thought", None), getattr(_p, "text", "")[:60]) for _p in _tr_resp.candidates[0].content.parts]
                    logger.info("TR parts: %s", _tr_parts)
                except Exception:
                    pass
                search_question = _tr_text or question
                logger.info("RU→UA: %s → %s", question[:80], search_question)
            except Exception:
                pass  # fallback — шукаємо оригінальним текстом

        async def _resolve_followup(q: str) -> str:
            if not body.history:
                return q
            try:
                recent = body.history[-6:]
                history_lines: list[str] = []
                for turn in recent:
                    role = turn.get("role", "")
                    content = (turn.get("content") or "").strip()
                    if not content:
                        continue
                    label = "Користувач" if role == "user" else "Асистент"
                    history_lines.append(f"{label}: {content[:900]}")
                if not history_lines:
                    return q

                _resolver_model_name = settings_cache.get("rewrite_model", "gemini-2.5-flash")
                _resolver = GenerativeModel(
                    _resolver_model_name,
                    system_instruction=(
                        "Ти перетворюєш уточнювальне питання в самостійний пошуковий запит "
                        "українською мовою для пошуку в юридичній базі. "
                        "Використовуй контекст попереднього діалогу лише якщо поточне питання без нього неоднозначне. "
                        "Не відповідай на питання. Не додавай фактів, яких немає в діалозі. "
                        "Поверни тільки один самостійний пошуковий запит без пояснень."
                    ),
                )
                _resolver_prompt = (
                    "Попередній діалог:\n"
                    + "\n".join(history_lines)
                    + f"\n\nПоточне питання: {q}\n\nСамостійний пошуковий запит:"
                )
                _resp = await _asyncio.wait_for(
                    _asyncio.to_thread(
                        _resolver.generate_content,
                        _resolver_prompt,
                        generation_config=GenerationConfig(temperature=0.0, max_output_tokens=350),
                    ),
                    timeout=6.0,
                )
                resolved = (_resp.text or "").strip().split("\n")[0].strip()
                if resolved and 8 <= len(resolved) <= 400:
                    logger.info("FOLLOWUP: %s → %s", q[:100], resolved[:180])
                    return resolved
            except Exception as e:
                logger.info("FOLLOWUP resolve failed: %s", e)
            return q

        _question_before_followup = search_question
        search_question = await _resolve_followup(search_question)
        _previous_user_question = _last_user_question(body.history)
        if _previous_user_question and _looks_like_followup(_question_before_followup):
            search_question = f"{search_question}\nКонтекст попереднього питання: {_previous_user_question}"
            logger.info("FOLLOWUP CONTEXT MERGE: %s", search_question[:220])

        async def _rewrite_query(q: str) -> str | None:
            """Переформулює запит у формальний юридичний стиль без вигадування законів."""
            try:
                # Для rewrite використовуємо легку flash-модель — думаюча модель виробляє сміття на цій задачі
                _rw_model_name = settings_cache.get("rewrite_model", "gemini-2.5-flash")
                _m = GenerativeModel(
                    _rw_model_name,
                    system_instruction=(
                        "Ти перефразовуєш запит користувача у стислий пошуковий запит "
                        "з офіційною юридичною термінологією українською мовою. "
                        "Зберігай ВСІ ключові поняття оригіналу — не додавай нових тем чи контексту якого немає в запиті. "
                        "Якщо запит вже зрозумілий — поверни його майже без змін. "
                        "Відповідь — ТІЛЬКИ перефразований запит, 5–15 слів, без пояснень, без лапок."
                    ),
                )
                try:
                    from vertexai.generative_models import ThinkingConfig
                    _rw_cfg = GenerationConfig(
                        temperature=0.0,
                        max_output_tokens=800,
                        thinking_config=ThinkingConfig(thinking_budget=0),
                    )
                except Exception:
                    _rw_cfg = GenerationConfig(temperature=0.0, max_output_tokens=800)
                _rewrite_examples = settings_cache.get("rewrite_examples", "")
                resp = await _asyncio.wait_for(
                    _asyncio.to_thread(
                        _m.generate_content,
                        f"{_rewrite_examples}\n{q} →",
                        generation_config=_rw_cfg,
                    ),
                    timeout=15.0,
                )
                # Debug: log all parts to understand model output
                try:
                    _dbg = [(getattr(p, "thought", None), getattr(p, "text", "")[:80]) for p in resp.candidates[0].content.parts]
                    logger.info("REWRITE parts: %s", _dbg)
                except Exception:
                    pass
                # Primary: resp.text (works when thinking disabled)
                raw = ""
                try:
                    raw = resp.text or ""
                except Exception:
                    pass
                if not raw:
                    # Fallback: concatenate all non-thought parts
                    try:
                        raw = " ".join(
                            getattr(p, "text", "").strip()
                            for p in resp.candidates[0].content.parts
                            if not getattr(p, "thought", False) and getattr(p, "text", "")
                        )
                    except Exception:
                        pass
                text = raw.strip().split("\n")[0].strip()
                logger.info("REWRITE raw=%r", text)
                if text and text.lower() != q.lower() and 5 < len(text) < 300 and len(text.split()) >= 4:
                    logger.info("REWRITE: %s → %s", q[:80], text)
                    return text
                return None
            except Exception as e:
                logger.info("REWRITE failed: %s", e)
                return None

        async def _embed_query_with_timeout(text: str):
            return await _asyncio.wait_for(
                _asyncio.to_thread(_embed_v2.embed_query, text),
                timeout=15.0,
            )

        # Embed оригінального запиту + rewrite паралельно
        query_vector, rewritten_query = await _asyncio.gather(
            _embed_query_with_timeout(search_question),
            _rewrite_query(search_question),
        )
        hypothetical_text = rewritten_query  # alias для title boost keywords
        logger.info("QUERY: %s", search_question[:200])
    except Exception as e:
        raise HTTPException(500, f"Embedding/HyDE error: {e}")

    # 2. Визначаємо колекції
    from qdrant_storage import search_qdrant, RADA_V2_COLLECTIONS, ALL_V2_COLLECTIONS

    # Крок 1: визначаємо дозволені колекції за тарифом
    if body.filter_sources:
        allowed = set(body.filter_sources)
        plan_collections: list[str] = []
        if "rada" in allowed:
            plan_collections += RADA_V2_COLLECTIONS
        if "supreme" in allowed:
            plan_collections.append("laws_supreme_v2")
        if "wiki" in allowed:
            plan_collections.append("laws_wiki_v2")
        if "ccu" in allowed:
            plan_collections.append("laws_ccu_v2")
        if "lpd" in allowed:
            plan_collections.append("laws_positions_v2")
        if "kmu" in allowed:
            plan_collections.append("laws_kmu_v2")
        if "mod" in allowed:
            plan_collections.append("laws_mod_v2")
        if "zir" in allowed:
            plan_collections.append("laws_zir_v2")
        if not plan_collections:
            plan_collections = ALL_V2_COLLECTIONS
    else:
        plan_collections = ALL_V2_COLLECTIONS

    # Крок 2: vector pre-scan звужує до релевантних колекцій в межах дозволених тарифом
    target_collections = await _classify_and_route(search_question, plan_collections, _model_name, query_vector=query_vector)

    fetch_k = body.max_docs * 5  # більше кандидатів для реранкера
    match_threshold = max(0.25, settings_cache.get_float("match_threshold_docs", 0.33))

    # 3. Multi-query пошук: оригінал + rewrite → merge по max score
    def _merge_results(lists: list[list]) -> list:
        seen: dict = {}
        for r in (item for lst in lists for item in lst):
            key = (r["out_metadata"].get("law_id", ""), r["out_metadata"].get("chunk_index", 0))
            if key not in seen or r["similarity"] > seen[key]["similarity"]:
                seen[key] = r
        return sorted(seen.values(), key=lambda x: x["similarity"], reverse=True)

    rw_vector = None
    try:
        if rewritten_query:
            rw_vector, orig_results = await _asyncio.gather(
                _asyncio.to_thread(_embed_v2.embed_query, rewritten_query),
                _asyncio.to_thread(search_qdrant, query_vector, fetch_k, target_collections, match_threshold),
            )
            rw_results = await _asyncio.to_thread(
                search_qdrant, rw_vector, fetch_k, target_collections, match_threshold
            )
            results = _merge_results([orig_results, rw_results])
        else:
            results = await _asyncio.to_thread(
                search_qdrant, query_vector, fetch_k, target_collections, match_threshold
            )
    except Exception:
        results = await _asyncio.to_thread(
            search_qdrant, query_vector, fetch_k, target_collections, match_threshold
        )
    raw_semantic_results = list(results)

    # LOW CONFIDENCE: якщо найкращий сирий score слабкий — не зупиняємось, не обрізаємо
    # Letting BM25 + title boost run fully — вони можуть витягнути релевантні документи
    # Gemini отримає guardrail в промпті і поверне "ось що є + рекомендую уточнити"
    _RAW_GATE = settings_cache.get_float("raw_gate_threshold", 0.42)
    low_confidence = bool(results and results[0]["similarity"] < _RAW_GATE)
    if low_confidence:
        logger.info("LOW CONFIDENCE: top raw score %.3f < %.2f → widening BM25/title scope",
                    results[0]["similarity"], _RAW_GATE)
        _lc_extra = ["rada_labor_v2", "rada_civil_v2", "laws_kmu_v2", "rada_finance_v2",
                     "laws_positions_v2", "rada_admin_v2", "rada_state_v2"]
        target_collections = list(dict.fromkeys(
            target_collections + [c for c in _lc_extra if c in plan_collections]
        ))
        logger.info("LOW CONFIDENCE: target_collections expanded → %s", target_collections)
    elif not results:
        logger.info("VECTOR: no hits above threshold %.2f → trying keyword/title fallback", match_threshold)

    # Diagnostic: log all found docs per collection
    _diag: dict[str, list] = {}
    for r in results:
        _diag.setdefault(r.get("_collection",""), []).append(
            f"{r['out_metadata'].get('law_id','?')}:{r['similarity']:.3f}"
        )
    for _c, _ids in _diag.items():
        logger.info("DOCS [%s]: %s", _c, " | ".join(_ids[:5]))

    # Source priority boost — піднімаємо Раду відносно Wiki/інших
    # laws_supreme soft penalty ×0.88: широкі PDF-огляди матчаться на все, знижуємо їх вагу
    # Значення > 1.0 = Рада іде вище; 1.0 = без буста (можна змінити в адмінці)
    rada_boost = settings_cache.get_float("rada_source_boost", 1.15)

    # ZIR boost для податкових запитів: ZIR — офіційна позиція ДПС, завжди актуальна.
    # Boost запобігає витісненню ZIR старими судовими рішеннями по тим же темам.
    _q_lower = body.question.lower()
    _is_tax_query = any(kw in _q_lower for kw in _TAX_KEYWORDS)
    _zir_boost = 1.3 if _is_tax_query else 1.0

    for r in results:
        col = r.get("_collection", "")
        if col == "laws_supreme_v2":
            r["similarity"] = r["similarity"] * 0.88
        elif col == "laws_zir_v2" and _is_tax_query:
            r["similarity"] = min(r["similarity"] * _zir_boost, 1.0)
        elif abs(rada_boost - 1.0) > 0.001 and (col.startswith("rada_") or col == "laws_positions_v2"):
            r["similarity"] = min(r["similarity"] * rada_boost, 1.0)

    # Authority score: boost/penalize by document type to prefer current legislation
    _DOC_TYPE_SCORE = {
        "Кодекс": 1.15,
        "Закон": 1.10,
        "Постанова": 1.05,
        "Наказ": 1.0,
        "Розпорядження": 1.0,
        "Лист": 0.75,
        "Роз'яснення": 0.80,
        "Інформаційний лист": 0.75,
    }
    for r in results:
        doc_type = r["out_metadata"].get("rada_doc_type") or r["out_metadata"].get("doc_type", "")
        factor = _DOC_TYPE_SCORE.get(doc_type, 1.0)
        if factor != 1.0:
            r["similarity"] = min(r["similarity"] * factor, 1.0)

    results.sort(key=lambda x: x["similarity"], reverse=True)

    # Dedup: max 2 chunks per law_id globally so one doc can't eat all slots
    _seen_lid: dict[str, int] = {}
    _deduped: list = []
    for r in results:
        lid = r["out_metadata"].get("law_id", "")
        if _seen_lid.get(lid, 0) < 2:
            _deduped.append(r)
            _seen_lid[lid] = _seen_lid.get(lid, 0) + 1
    results = _deduped

    # Diversity: кожна колекція отримує гарантовані слоти; court collections обмежені
    _MAX_COURT = max(2, body.max_docs // 4)  # cap for laws_supreme і laws_positions
    _max_pos = max(1, body.max_docs // 4)    # strict cap for laws_positions

    # Групуємо результати по колекціях
    _by_col: dict[str, list] = {}
    for r in results:
        col = r.get("_collection", "")
        _by_col.setdefault(col, []).append(r)

    _pos_col = _by_col.pop("laws_positions_v2", [])
    _sup_col = _by_col.pop("laws_supreme_v2", [])
    pos_taken = _pos_col[:_max_pos]
    sup_taken = _sup_col[:_MAX_COURT]

    _n_cols = len(_by_col) or 1
    # Скільки слотів гарантовано кожній колекції (мін 2, лишаємо ~1/4 для overflow)
    _guaranteed_each = max(2, (body.max_docs * 3 // 4) // _n_cols)
    _per_col_cap = _guaranteed_each + 2

    guaranteed: list = []
    overflow: list = []
    for col, docs in _by_col.items():
        guaranteed.extend(docs[:_guaranteed_each])
        overflow.extend(docs[_guaranteed_each:_per_col_cap])

    remaining = body.max_docs - len(pos_taken) - len(sup_taken) - len(guaranteed)
    filler = sorted(
        overflow + _pos_col[_max_pos:] + _sup_col[_MAX_COURT:],
        key=lambda x: x["similarity"], reverse=True,
    )
    results = pos_taken + sup_taken + guaranteed + filler[:max(0, remaining)]
    results.sort(key=lambda x: x["similarity"], reverse=True)

    # Діагностичний лог — видно в journalctl
    _col_counts = {}
    for r in results:
        _col_counts[r.get("_collection", "?")] = _col_counts.get(r.get("_collection", "?"), 0) + 1
    logger.info(
        "ASK found=%d cols=%s | top: %s",
        len(results),
        dict(sorted(_col_counts.items())),
        " | ".join(
            f"{r['_collection']}:{r['out_metadata'].get('law_id','?')}:{r['similarity']:.3f}"
            for r in results[:6]
        ) or "NONE",
    )

    # Document-set expansion: first select several relevant documents, then fetch
    # only the best sibling chunks inside each law_id. This avoids both extremes:
    # one-document tunnel vision and sending entire large laws to the model.
    try:
        from qdrant_storage import search_law_chunks_by_terms, search_qdrant_in_law, get_all_law_chunks
        _expanded_keys = {
            (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
            for r in results
        }
        _term_text = f"{search_question} {rewritten_query or ''}".strip()
        _doc_terms = _query_terms(_term_text, limit=18)
        _expand_min_score = max(match_threshold, 0.55)

        _seed_candidates: dict[tuple[str, str], dict] = {}
        _seed_pool = list(raw_semantic_results[: max(20, body.max_docs * 3)]) + list(results)
        for r in _seed_pool:
            sim = r.get("similarity", 0.0)
            if sim < _expand_min_score:
                continue
            _col = r.get("_collection", "")
            _lid = r["out_metadata"].get("law_id", "")
            if not _col or not _lid:
                continue
            _doc_key = (_col, _lid)
            _overlap = _term_overlap_score(r, _doc_terms)
            _authority = _authority_score(r)
            _score = (sim * 0.70) + (min(_overlap, 6) * 0.035) + (_authority * 0.22)
            prev = _seed_candidates.get(_doc_key)
            if not prev or _score > prev["score"]:
                _seed_candidates[_doc_key] = {
                    "score": _score,
                    "overlap": _overlap,
                    "similarity": sim,
                    "authority": _authority,
                }

        _expanded_added = 0
        _expansion_vector = rw_vector or query_vector
        _seed_limit = int(settings_cache.get_float("doc_expansion_max_docs", min(8, max(4, body.max_docs // 2))))
        _per_doc_limit = int(settings_cache.get_float("doc_expansion_chunks_per_doc", 3))
        _seed_docs = sorted(
            _seed_candidates.items(),
            key=lambda item: (
                item[1]["score"],
                item[1]["authority"],
                item[1]["overlap"],
                item[1]["similarity"],
            ),
            reverse=True,
        )[:_seed_limit]

        _FULL_LAW_MIN_SCORE = 0.75  # якщо топ-1 seed скорить так — беремо ВСІ чанки
        _FULL_LAW_MAX = 20          # максимум чанків для full-law expansion

        for _doc_rank, ((_col, _lid), _seed_info) in enumerate(_seed_docs, start=1):
            _seed_score = _seed_info["similarity"]
            if _doc_rank == 1 and _seed_score >= _FULL_LAW_MIN_SCORE:
                # Топ-1 закон з високою впевненістю → ВСІ чанки по порядку (включно з таблицями)
                _doc_chunks = get_all_law_chunks(_col, _lid, max_chunks=_FULL_LAW_MAX)
                logger.info("FULL LAW: %s/%s score=%.3f → %d chunks", _col, _lid, _seed_score, len(_doc_chunks))
                _taken_for_doc = 0
                for _chunk in _doc_chunks:
                    _key = (
                        _chunk["out_metadata"].get("law_id"),
                        _chunk["out_metadata"].get("chunk_index"),
                    )
                    if _key in _expanded_keys:
                        continue
                    _chunk["_docset_rank"] = _doc_rank
                    _chunk["_docset_overlap"] = _seed_info["overlap"]
                    results.append(_chunk)
                    _expanded_keys.add(_key)
                    _expanded_added += 1
                    _taken_for_doc += 1
                continue

            _doc_chunks = search_qdrant_in_law(
                _col, _lid, _expansion_vector, top_k=_per_doc_limit, threshold=0.0
            )
            _doc_chunks += search_law_chunks_by_terms(
                _col, _lid, _doc_terms, top_k=_per_doc_limit
            )
            _doc_chunks = sorted(
                _doc_chunks,
                key=lambda c: (
                    _term_overlap_score(c, _doc_terms),
                    c.get("similarity", 0.0),
                ),
                reverse=True,
            )
            _taken_for_doc = 0
            for _chunk in _doc_chunks:
                if _taken_for_doc >= _per_doc_limit:
                    break
                _key = (
                    _chunk["out_metadata"].get("law_id"),
                    _chunk["out_metadata"].get("chunk_index"),
                )
                if _key in _expanded_keys:
                    continue
                _chunk["similarity"] = max(_chunk.get("similarity", 0.0), 0.68)
                _chunk["_docset_rank"] = _doc_rank
                _chunk["_docset_overlap"] = _seed_info["overlap"]
                results.append(_chunk)
                _expanded_keys.add(_key)
                _expanded_added += 1
                _taken_for_doc += 1
        if _expanded_added:
            results.sort(key=lambda x: x["similarity"], reverse=True)
            logger.info(
                "DOC SET EXPANSION: додано %d чанків із %d документів: %s",
                _expanded_added,
                len(_seed_docs),
                [f"{col}:{lid}:s={info['score']:.3f}:ov={info['overlap']}:a={info['authority']:.2f}" for (col, lid), info in _seed_docs[:8]],
            )
    except Exception as _de_err:
        logger.warning("Doc expansion error: %s", _de_err)

    # Keyword search: завжди паралельно з vector — знаходить документи з поганим embedding
    min_score = settings_cache.get_float("min_relevance_score", 0.35)
    _existing_ids = {
        (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
        for r in results
    }
    try:
        from qdrant_storage import search_qdrant_text
        _kw_query = f"{search_question} {rewritten_query or ''}".strip()
        _kw_results = (
            search_qdrant_text(_kw_query, target_collections, limit=15)
            if settings_cache.get_bool("lexical_fallback_enabled", True)
            else []
        )
        _kw_query_words = {w.lower() for w in _kw_query.split() if len(w) > 4 or (len(w) >= 2 and w.isupper())}
        _kw_stopwords = {
            "надай", "надайте", "інформацію", "інформація", "інфо", "питання",
            "щодо", "стосовно",
        }
        _kw_query_words = {w for w in _kw_query_words if w not in _kw_stopwords}
        # Лематизація через pymorphy замість агресивного [:-2] обрізання
        _kw_stems = _kw_query_words | {_ua_lemma(w) for w in _kw_query_words if _ua_lemma(w)}
        _kw_stems = {w for w in _kw_stems if w and w not in _kw_stopwords}
        _kw_added = 0
        _kw_cap = max(12, body.max_docs * 3)
        _kw_min_matches = 2 if len(_kw_stems) >= 3 else 1
        for r in _kw_results:
            if _kw_added >= _kw_cap:
                break
            _key = (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
            if _key in _existing_ids:
                continue
            # Відхиляємо keyword результат якщо ні заголовок НІ зміст чанку не мають нічого спільного з запитом
            # Перевіряємо і source (title) і перші 600 символів контенту — щоб знаходити документи
            # де запитне слово є в тексті (напр. "добових" у таблиці) але не в заголовку
            _src = (
                r["out_metadata"].get("source", "") + " " +
                r["out_metadata"].get("doc_type", "") + " " +
                r.get("out_content", "")[:1500]
            ).lower()
            if not any(s in _src for s in _kw_stems):
                continue
            # Динамічний score: більше збіглих стемів → вищий score (0.25–0.60)
            _matched = sum(1 for s in _kw_stems if s in _src)
            if _matched < _kw_min_matches:
                continue
            _bm25_score = 0.25 + 0.35 * (_matched / max(len(_kw_stems), 1))
            # KMU і positions keyword matches буст: ці колекції часто мають табличний текст
            # що погано матчиться векторно, але точно відповідає по ключових словах
            if r.get("_collection") in ("laws_kmu_v2", "laws_positions_v2"):
                _bm25_score = min(_bm25_score + 0.20, 0.72)
            r["similarity"] = _bm25_score
            results.append(r)
            _existing_ids.add(_key)
            _kw_added += 1
        if _kw_added:
            results.sort(key=lambda x: x["similarity"], reverse=True)
            logger.info("Keyword: додано %d нових результатів", _kw_added)
    except Exception as _kw_err:
        logger.warning("Keyword search error: %s", _kw_err)

    # Title-based metadata boost: знаходить документи по заголовку (source поле)
    # Стоп-слова: розмовні та функціональні слова які НЕ є юридичними термінами
    _TITLE_STOPWORDS = {
        "цікавить", "цікавити", "хочу", "хочете", "знайти", "скажи", "скажіть",
        "розкажи", "розкажіть", "питання", "допоможи", "допоможіть", "можна",
        "можете", "будь", "ласка", "треба", "потрібно", "потрібен", "потрібна",
        "щодо", "стосовно", "якого", "якій", "яким", "яких", "тобто", "також",
        "взагалі", "зокрема", "наприклад", "взагалі", "наразі", "зараз",
        "правда", "справді", "взнати", "дізнатись", "дізнатися", "пояснити",
        "пояснення", "розмір", "кількість", "інформація", "питати", "запитати",
        "надай", "надайте", "інформацію", "інфо", "покажи", "покажіть",
    }
    try:
        from qdrant_storage import search_qdrant_by_title
        import re as _re
        _strip_punct = lambda w: _re.sub(r"^[«»\"'()\[\].,;:!?]+|[«»\"'()\[\].,;:!?]+$", "", w)
        _search_terms_text = f"{search_question} {rewritten_query or ''}".strip()
        _q_words = [_strip_punct(w) for w in _search_terms_text.split() if len(w) > 4]
        _q_words = [w for w in _q_words if len(w) > 4 and w.lower() not in _TITLE_STOPWORDS]
        _hyde_words = [_strip_punct(w) for w in (hypothetical_text or "").split() if len(w) > 5][:10]
        _hyde_words = [w for w in _hyde_words if len(w) > 4 and w.lower() not in _TITLE_STOPWORDS]
        _raw_kws = list(dict.fromkeys(_q_words[:3] + _hyde_words))[:10]
        # pymorphy3: додаємо лематизовані форми — відрядженні→відрядження автоматично
        # Лематизовані форми теж фільтруємо через стоп-слова
        _title_kws = list(dict.fromkeys(
            _raw_kws + [
                lm for w in _raw_kws
                if (lm := _ua_lemma(w)) and lm.lower() not in _TITLE_STOPWORDS
            ]
        ))[:14]
        logger.info("TITLE BOOST kws: %s", _title_kws)
        if not settings_cache.get_bool("title_boost_enabled", True):
            _title_kws = []
        if _title_kws:
            _title_results = search_qdrant_by_title(_title_kws, target_collections, chunks_per_doc=2)
            # Sort: specific law collections first (laws_kmu, laws_supreme) before broad rada collections
            _COL_PRI = {"laws_kmu_v2": 0, "laws_supreme_v2": 1, "laws_ccu_v2": 2, "laws_wiki_v2": 3}
            _title_results.sort(key=lambda r: _COL_PRI.get(r.get("_collection", ""), 9))
            _title_cap = int(settings_cache.get_float("title_boost_max_chunks", 16))
            _title_results = _title_results[:max(4, min(_title_cap, 24))]
            logger.info("TITLE BOOST found: %s", [r["out_metadata"].get("law_id") for r in _title_results])
            _title_added = 0
            for r in _title_results:
                _key = (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
                if _key not in _existing_ids:
                    # Динамічний score: скільки _title_kws є в назві документа (0.50–0.85)
                    _tsrc = (
                        r["out_metadata"].get("source", "") + " " +
                        r.get("out_content", "")[:1500]
                    ).lower()
                    _tmatched = sum(1 for kw in _title_kws if kw.lower() in _tsrc)
                    r["similarity"] = 0.50 + 0.35 * (_tmatched / max(len(_title_kws), 1))
                    results.append(r)
                    _existing_ids.add(_key)
                    _title_added += 1
            if _title_added:
                results.sort(key=lambda x: x["similarity"], reverse=True)
                logger.info("TITLE BOOST: додано %d чанків", _title_added)
    except Exception as _tb_err:
        logger.warning("Title boost error: %s", _tb_err)

    # Unified pre-sort: title_match chunks отримують бонус якщо вони підтверджені семантикою
    # Мета: реранкер бачить найбільш різноманітних кандидатів, а не просто топ-40 за вектором
    _seen_laws_in_semantic = {r["out_metadata"].get("law_id") for r in results if not r.get("_title_match")}
    for r in results:
        if r.get("_title_match") and r["out_metadata"].get("law_id") in _seen_laws_in_semantic:
            r["similarity"] = min(r["similarity"] + 0.10, 0.99)  # підтверджено обома — буст
    results.sort(key=lambda x: x["similarity"], reverse=True)

    _answerability_query = f"{search_question} {rewritten_query or ''}".strip()
    if len(results) > body.max_docs * 2:
        results = _rerank_by_answerability(
            results,
            _answerability_query,
            max(body.max_docs * 2, body.max_docs),
            keep_weak=low_confidence,
        )

    # Protected slots: keep the strongest chunk from several expanded documents so
    # reranker cannot collapse a multi-document answer back to one law_id.
    _protected_colls = {"laws_kmu_v2", "laws_positions_v2"}
    _rr_protected = [
        r for r in results
        if r.get("_collection") in _protected_colls
        and (r.get("_title_match") or r.get("_doc_expansion"))
        and r["out_metadata"].get("law_id") in _seen_laws_in_semantic
    ][:3]
    _docset_terms = _query_terms(f"{search_question} {rewritten_query or ''}", limit=18)
    _docset_keep: list[dict] = []
    _docset_seen: set[tuple[str, str]] = set()
    for _r in sorted(
        (r for r in results if r.get("_doc_expansion")),
        key=lambda r: (
            -int(r.get("_docset_rank") or 999),
            _authority_score(r),
            _term_overlap_score(r, _docset_terms),
            r.get("similarity", 0.0),
        ),
        reverse=True,
    ):
        _doc_key = (_r.get("_collection", ""), _r["out_metadata"].get("law_id", ""))
        if _doc_key in _docset_seen:
            continue
        if _term_overlap_score(_r, _docset_terms) <= 0:
            continue
        _docset_keep.append(_r)
        _docset_seen.add(_doc_key)
        if len(_docset_keep) >= max(3, min(6, body.max_docs // 2)):
            break
    for _dk in _docset_keep:
        _dk_key = (_dk["out_metadata"].get("law_id"), _dk["out_metadata"].get("chunk_index"))
        if _dk_key not in {
            (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
            for r in _rr_protected
        }:
            _rr_protected.append(_dk)
    _wiki_keep = [
        r for r in results
        if r.get("_collection") == "laws_wiki_v2" and r.get("similarity", 0.0) >= 0.60
    ][:1]
    for _wk in _wiki_keep:
        _wk_key = (_wk["out_metadata"].get("law_id"), _wk["out_metadata"].get("chunk_index"))
        if _wk_key not in {
            (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
            for r in _rr_protected
        }:
            _rr_protected.append(_wk)
    # Full-law chunks (sorted by chunk_index) bypass reranker entirely:
    # table rows like "| США | 80 | 240 |" have zero term-overlap but contain the actual amounts
    _rr_protected_key_set = {
        (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
        for r in _rr_protected
    }
    _fl_added = 0
    for _fl in [r for r in results if r.get("_full_law")]:
        if _fl_added >= 15:
            break
        _fl_key = (_fl["out_metadata"].get("law_id"), _fl["out_metadata"].get("chunk_index"))
        if _fl_key not in _rr_protected_key_set:
            _rr_protected.append(_fl)
            _rr_protected_key_set.add(_fl_key)
            _fl_added += 1
    if _fl_added:
        logger.info("FULL LAW PROTECTED: %d chunks bypassing reranker", _fl_added)
    _rr_protected_keys = {
        (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
        for r in _rr_protected
    }

    # Fast deterministic answerability reranker is the default. LLM reranker remains
    # available behind a setting, but it is slower and can pick topically similar
    # fragments that do not answer the exact question.
    _llm_reranker_enabled = settings_cache.get_bool("llm_reranker_enabled", False)
    if len(results) > body.max_docs and _llm_reranker_enabled:
        try:
            import asyncio as _aio
            _rerank_model = GenerativeModel(_model_name)
            _rr_cfg = GenerationConfig(temperature=0.0, max_output_tokens=200)
            _open_candidates = [r for r in results
                                if (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
                                not in _rr_protected_keys]
            _candidates = _open_candidates[:min(len(_open_candidates), 60)]
            def _rr_candidate_text(i: int, c: dict) -> str:
                meta = c["out_metadata"]
                title = meta.get("source") or meta.get("title") or "Без назви"
                law_id = meta.get("law_id", "")
                doc_type = meta.get("rada_doc_type") or meta.get("doc_type", "")
                collection = c.get("_collection", "")
                return (
                    f"[{i + 1}] collection={collection}; title={title}; "
                    f"law_id={law_id}; doc_type={doc_type}\n"
                    f"{c['out_content'][:700]}"
                )

            _chunks_text = "\n\n".join(
                _rr_candidate_text(i, c)
                for i, c in enumerate(_candidates)
            )
            # Cap: мін 8, до половини max_docs; з урахуванням protected slots
            _rr_select = min(body.max_docs, max(8, body.max_docs // 2))
            _rr_slots = max(1, _rr_select - len(_rr_protected))
            _rerank_prompt = (
                f"Respond ONLY with a JSON object, no other text.\n"
                f"Format: {{\"indices\": [3, 7, 1, 12]}}\n\n"
                f"Task: select the {_rr_slots} most relevant fragments for the question below.\n"
                f"Priority: direct normative acts and official procedures first "
                f"(laws/codes, KMU resolutions, ministry orders/instructions), then official tax explanations, "
                f"then court positions, then wiki/background materials.\n"
                f"Indices are fragment numbers from 1 to {len(_candidates)}.\n\n"
                f"Question: {search_question}\n\n"
                f"{_chunks_text}"
            )
            try:
                from vertexai.generative_models import ThinkingConfig as _RrThinkingConfig
                _rr_cfg_json = GenerationConfig(
                    temperature=0.0,
                    max_output_tokens=1024,
                    response_mime_type="application/json",
                    thinking_config=_RrThinkingConfig(thinking_budget=0),
                )
            except Exception:
                _rr_cfg_json = GenerationConfig(
                    temperature=0.0,
                    max_output_tokens=1024,
                    response_mime_type="application/json",
                )
            _rr_resp = await _aio.to_thread(
                _rerank_model.generate_content, _rerank_prompt,
                generation_config=_rr_cfg_json,
            )
            _rr_raw = ""
            try:
                _rr_raw = _rr_resp.text or ""
            except Exception:
                pass
            if not _rr_raw:
                try:
                    _rr_raw = " ".join(
                        getattr(_p, "text", "").strip()
                        for _p in _rr_resp.candidates[0].content.parts
                        if not getattr(_p, "thought", False) and getattr(_p, "text", "")
                    )
                except Exception:
                    pass
            
            _raw_indices = []
            try:
                import json, re as _re
                # Strip markdown code fences (```json ... ```) before parsing
                _rr_clean = _re.sub(r'^```(?:json)?\s*|\s*```\s*$', '', _rr_raw.strip(), flags=_re.DOTALL)
                _rr_clean = _rr_clean.replace("'", '"')
                _parsed = json.loads(_rr_clean)
                _raw_indices = _parsed.get("indices", [])
            except Exception as e:
                logger.warning(f"Reranker JSON parse error: {e} | Raw: {_rr_raw[:120]}")
                # Regex fallback: extract numbers even from non-JSON response
                import re as _re
                _found_nums = _re.findall(r'\b(\d+)\b', _rr_raw)
                _raw_indices = [int(n) for n in _found_nums if 1 <= int(n) <= len(_candidates)]

            _indices = []
            for num in _raw_indices:
                try:
                    idx = int(num) - 1
                    if 0 <= idx < len(_candidates) and idx not in _indices:
                        _indices.append(idx)
                except ValueError:
                    pass
            if len(_indices) >= 1:
                reranked = [_candidates[i] for i in _indices[:_rr_slots]]
                # доповнюємо семантичними топ-результатами якщо реранкер вибрав менше ніж треба
                if len(reranked) < _rr_slots:
                    _ranked_ids = {(r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index")) for r in reranked}
                    for _c in _candidates:
                        if len(reranked) >= _rr_slots:
                            break
                        _ck = (_c["out_metadata"].get("law_id"), _c["out_metadata"].get("chunk_index"))
                        if _ck not in _ranked_ids:
                            reranked.append(_c)
                            _ranked_ids.add(_ck)
                # Merge: protected (laws_kmu/positions з title match) + reranked open candidates
                results = (_rr_protected + reranked)[:body.max_docs]
                if _rr_protected:
                    logger.info("RERANKER: protected=%d + reranked=%d → total=%d",
                                len(_rr_protected), len(reranked), len(results))
                logger.info("RERANKER: %d→%d chunks (indices: %s)", len(_candidates), len(results), _indices[:body.max_docs])
            else:
                results = results[:body.max_docs]
                logger.info("RERANKER: fallback (parsed 0 indices, raw=%r)", _rr_raw[:80])
        except Exception as _rr_err:
            logger.warning("Reranker error: %s", _rr_err)
            results = results[:body.max_docs]
    else:
        results = _rerank_by_answerability(
            results,
            _answerability_query,
            body.max_docs,
            keep_weak=low_confidence,
        )

    results = _rerank_by_answerability(
        results,
        _answerability_query,
        body.max_docs,
        keep_weak=low_confidence,
    )

    logger.info("FINAL RESULTS: %d chunks → Gemini", len(results))

    # Hard-stop: якщо нічого релевантного — не викликаємо Gemini, не галюцинуємо
    # В low_confidence режимі пропускаємо (Gemini вже отримає guardrail в промпті)
    if not low_confidence and (not results or results[0]["similarity"] < min_score):
        return {"early_answer": {
            "answer": (
                "На жаль, у базі знань не знайдено достатньо інформації для відповіді на це питання. "
                "Спробуйте переформулювати запит або зверніться до юриста."
            ),
            "references": [],
            "templates": [],
            "_meta": {
                "processing_time_ms": int((time.time() - start_time) * 1000),
                "tokens_used": 0,
                "category": "Загальне",
                **_CLF_FALLBACK,
            },
        }}

    # 3. Будуємо збагачений контекст для LLM + citations для фронтенду
    # law_chunks — закони Ради; kmu_chunks — постанови КМУ; court_chunks — судова практика
    citations: list[dict] = []
    law_chunks:   list[str] = []
    kmu_chunks:   list[str] = []
    court_chunks: list[str] = []

    # Скасовані документи виключаємо повністю — не в контекст, не в citations
    # (вони дезорієнтують LLM і вводять користувача в оману)
    def _is_expired(r: dict) -> bool:
        m = r["out_metadata"]
        if m.get("rada_is_dead"):
            return True
        s = m.get("status", "").lower()
        return "втратив" in s or "втратила" in s

    results = [r for r in results if not _is_expired(r)]

    for i, r in enumerate(results):
        num = i + 1
        meta = r["out_metadata"]
        content = r["out_content"]
        title = meta.get("source", meta.get("title", ""))
        law_id = meta.get("law_id", "")
        source_domain = meta.get("source_domain", "")
        law_url = meta.get("law_url", "")
        if not law_url and source_domain and "rada.gov.ua" in source_domain and law_id:
            law_url = f"https://zakon.rada.gov.ua/laws/show/{law_id}"

        # Чистий уривок для citations на фронтенді
        clean_passage = re.sub(r"```[a-z]*", "", content)
        clean_passage = re.sub(r"\n{3,}", "\n\n", clean_passage).strip()[:600]

        citations.append({
            "num":           num,
            "source_title":  title,
            "passage":       clean_passage,
            "status":        meta.get("status", ""),
            "law_url":       law_url,
            "chunk_index":   meta.get("chunk_index", 0),
            # enriched OpenData fields (present after meta enrichment)
            "rada_status_name":  meta.get("rada_status_name", ""),
            "rada_is_dead":      meta.get("rada_is_dead", False),
            "rada_no_text":      meta.get("rada_no_text", False),
            "rada_adopted_date": meta.get("rada_adopted_date", ""),
            "rada_last_edition": meta.get("rada_last_edition", ""),
            "rada_dead_since":   meta.get("rada_dead_since", ""),
            "rada_replaced_by":  meta.get("rada_replaced_by", []),
            "rada_cancelled_by": meta.get("rada_cancelled_by", []),
            "rada_theme":        meta.get("rada_theme", ""),
            "rada_org":          meta.get("rada_org", ""),
            "rada_doc_type":     meta.get("rada_doc_type", ""),
        })

        if not content:
            continue

        status = meta.get("status", "")
        doc_type = meta.get("doc_type", "")
        effective_date = meta.get("effective_date", "") or (meta.get("scraped_at", "") or "")[:10]

        # Попередження про спеціальний правовий статус
        warnings: list[str] = []
        if meta.get("wartime_only"):
            warnings.append("⚠️ ДІЄ ЛИШЕ В УМОВАХ ВОЄННОГО СТАНУ")
        if meta.get("is_suspended"):
            warnings.append("⚠️ ДІЮ ПРИЗУПИНЕНО / МОРАТОРІЙ")
        if meta.get("is_retroactive"):
            warnings.append("⚠️ МАЄ ЗВОРОТНЮ ДІЮ")

        header_parts = [f"[{num}] {title}"]
        if doc_type:
            header_parts.append(doc_type)
        if law_id:
            header_parts.append(f"№ {law_id}")
        if status:
            header_parts.append(f"Статус: {status}")
        if effective_date:
            header_parts.append(f"Дата: {effective_date}")

        chunk_text = " | ".join(header_parts)
        if warnings:
            chunk_text += "\n" + "\n".join(warnings)
        chunk_text += f"\n---\n{content}"

        # Розподіляємо за правовою ієрархією: закони → КМУ → суди
        col = r.get("_collection", "")
        if col in ("laws_positions_v2", "laws_supreme_v2", "laws_ccu_v2"):
            court_chunks.append(chunk_text)
        elif col == "laws_kmu_v2":
            kmu_chunks.append(chunk_text)
        else:
            law_chunks.append(chunk_text)

    # Контекст: 1) закони Ради, 2) постанови КМУ, 3) судова практика
    # Per-bucket cap — не даємо одному типу з'їсти весь context window
    _MAX_LAW = 15
    _MAX_KMU = 8
    _MAX_COURT = 6
    parts: list[str] = []
    if law_chunks:
        parts.append("\n\n".join(law_chunks[:_MAX_LAW]))
    if kmu_chunks:
        parts.append(
            "--- Постанови та розпорядження КМУ ---\n\n"
            + "\n\n".join(kmu_chunks[:_MAX_KMU])
        )
    if court_chunks:
        parts.append(
            "--- Судова практика та правові позиції ---\n\n"
            + "\n\n".join(court_chunks[:_MAX_COURT])
        )
    context = "\n\n".join(parts) if parts else "Контекст відсутній."
    # Hard cap на весь context — менший, чистіший контекст зазвичай точніший і швидший.
    _context_char_cap = int(settings_cache.get_float("context_char_cap", 30000))
    if len(context) > _context_char_cap:
        context = context[:_context_char_cap] + "\n\n[...контекст обрізано для економії токенів]"

    # 4. Call Gemini — main answer + classification run concurrently (zero added latency)
    try:
        model_name    = _model_name
        system_prompt = settings_cache.get(
            "system_prompt", # Ключ для завантаження з кешу
            ( # Резервний (fallback) промпт, якщо в базі нічого немає
                "Ти — AI-асистент. Відповідай виключно на основі наданого контексту. "
                "Цитуй джерела у форматі [1], [2]. "
                "Якщо відповіді немає в контексті, повідом про це."
            ), # Цей резервний промпт максимально простий, щоб не конфліктувати з основним.
        )
        temperature      = settings_cache.get_float("temperature", 0.1)
        top_p            = settings_cache.get_float("top_p", 0.8)
        response_length_pref = body.response_length_pref if body.response_length_pref in {"short", "standard", "detailed", "full"} else "standard"
        is_short_response = response_length_pref == "short"
        is_detailed_response = response_length_pref in {"detailed", "full"}
        is_full_response = response_length_pref == "full"
        configured_max_output_tokens = int(settings_cache.get_float("max_output_tokens", 8000))
        _pref_token_bounds = {
            "short": (1200, 1800),
            "standard": (1800, 2600),
            "detailed": (4200, 5600),
            "full": (6500, 9000),
        }
        _min_tokens, _max_tokens = _pref_token_bounds[response_length_pref]
        max_output_tokens = min(max(configured_max_output_tokens, _min_tokens), _max_tokens)

        # Build response instructions based on plan features
        rf = set(body.response_features)
        response_instructions = ["Надай точну структуровану відповідь."]
        if is_short_response:
            response_instructions.append(
                "РЕЖИМ КОРОТКОЇ ВІДПОВІДІ: дай компактну, але повну відповідь без довгих вступів і повторів. "
                "Формат: 2-4 короткі абзаци або 4-6 коротких пунктів. "
                "Поясни головну норму, ключові підстави/винятки і практичний висновок. "
                "Посилання [N] став там, де є юридичні твердження."
            )
        if response_length_pref == "standard":
            response_instructions.append(
                "РЕЖИМ СТАНДАРТНОЇ ВІДПОВІДІ: дай збалансовану відповідь без зайвого розширення. "
                "Поясни норму, практичний висновок і тільки найважливіші нюанси."
            )
        if "response_detailed" in rf and response_length_pref == "detailed":
            response_instructions.append(
                "РЕЖИМ РОЗГОРНУТОЇ ВІДПОВІДІ: дай більше деталей, нюансів, винятків і практичних застережень. "
                "Жорстка структура: 5-7 коротких секцій, у кожній 1-3 абзаци або пункти. "
                "Не перетворюй відповідь на повний меморандум і не переказуй усі джерела підряд."
            )
        if "response_detailed" in rf and is_full_response:
            response_instructions.append(
                "РЕЖИМ ПОВНОГО АНАЛІЗУ: дай глибокий структурований розбір як юридичний memo. "
                "Жорстка структура: 7-9 секцій. Розкрий правову рамку, фактичні умови, винятки, ризики, "
                "докази/документи та практичну стратегію. Якщо матеріалу багато, групуй джерела за темами, "
                "а не описуй кожне джерело окремо."
            )
        if "response_steps" in rf and is_short_response:
            response_instructions.append(
                "Якщо потрібні дії, додай максимум 2 короткі наступні кроки без окремого великого розділу."
            )
        elif "response_steps" in rf:
            response_instructions.append(
                "Обов'язково додай розділ «Що робити далі» з конкретними покроковими діями."
            )
        if "response_scenarios" in rf and is_detailed_response:
            response_instructions.append(
                "Розглянь альтернативні сценарії розвитку ситуації та їхні наслідки."
            )
        if "response_vs_position" in rf:
            response_instructions.append(
                "Посилайся на конкретні правові позиції Верховного суду з джерел, якщо вони присутні в контексті."
            )
        # Citation-strict rule — ЗАВЖДИ, для всіх результатів
        response_instructions.append(
            "ПРАВИЛО ЦИТУВАННЯ (обов'язкове): кожне юридичне твердження МУСИТЬ мати посилання [N]. "
            "Якщо не можеш процитувати конкретний пункт із наданих документів — НЕ пиши це твердження взагалі. "
            "Використовуй точні юридичні терміни з документа і не підміняй одне поняття іншим."
        )

        # Retrieval quality guardrail — якщо пошук слабкий, чіткий вердикт замість домислів
        _retrieval_top = results[0]["similarity"] if results else 0.0
        _top_answerability = results[0].get("_answerability", {}) if results else {}
        _top_answerability_score = float(_top_answerability.get("score", 0.0) or 0.0)
        _top_answerability_cov = float(_top_answerability.get("coverage", 0.0) or 0.0)
        if _top_answerability_score < 0.38 or _top_answerability_cov < 0.25:
            response_instructions.append(
                "ПЕРЕВІРКА ПРЯМОЇ ВІДПОВІДІ: перед відповіддю визнач, чи контекст прямо покриває всі істотні умови питання. "
                "Якщо документи лише тематично схожі, але не відповідають на конкретну комбінацію умов із питання, "
                "почни з чіткого висновку: «У наданих джерелах прямої норми щодо цієї конкретної ситуації не знайдено». "
                "Після цього коротко поясни, що саме знайдено в найближчих джерелах, без домислів."
            )
        if low_confidence and is_short_response:
            response_instructions.append(
                "УВАГА: знайдено лише слабко пов'язані документи. Для короткого режиму: "
                "1) в 1 реченні скажи, що прямої відповіді не знайдено; "
                "2) згадай максимум 2-3 найближчі документи з [N]; "
                "3) постав одне коротке уточнювальне питання. НЕ перераховуй усі документи."
            )
        elif low_confidence:
            response_instructions.append(
                "УВАГА: знайдено лише слабко пов'язані документи (низька впевненість). "
                "Структура відповіді: "
                "1) Перелічи ВСІ знайдені документи (назви з [N]) — навіть якщо вони лише частково стосуються теми. "
                "2) Що може бути частково корисним у кожному документі (з цитуванням [N]). "
                "3) Окремим абзацом: «⚠️ Точної прямої відповіді щодо [аспект запиту] не знайдено. "
                "Рекомендую уточнити запит або звернутись до юриста.» "
                "НЕ вигадуй норм, яких немає в документах."
            )
        elif _retrieval_top < 0.68 and is_short_response:
            response_instructions.append(
                "УВАГА: знайдені документи лише частково відповідають запиту. Для короткого режиму: "
                "назви максимум 2-3 найближчі документи з [N], коротко скажи що саме в них є, "
                "і не додавай окремий довгий список."
            )
        elif _retrieval_top < 0.68:
            response_instructions.append(
                "УВАГА: знайдені документи лише частково відповідають запиту — можливо, знайдено лише "
                "вступну частину документа без конкретних цифр/норм. "
                "Структура відповіді: "
                "1) Назви ВСІХ знайдених документів (НПА, постанови, статті — за назвою з [N]), "
                "навіть якщо вони містять лише загальну інформацію. "
                "2) Що ПРЯМО знайдено в кожному документі (з цитуванням [N]). "
                "3) Якщо конкретної відповіді на запит немає в наданому тексті — "
                "явно скажи: «Документ [N] містить лише [що є], але конкретні [що шукали] "
                "є у повному тексті за посиланням.» "
                "4) Окремим рядком: що САМЕ потрібно шукати у повному тексті. "
                "НЕ починай відповідь з «не знайдено» — спочатку покажи що є."
            )

        # Clarifying / follow-up question — умовно: обов'язково якщо тема неоднозначна
        _top_for_q = results[0]["similarity"] if results else 0.0
        if low_confidence or _top_for_q < 0.75:
            response_instructions.append(
                "ОБОВ'ЯЗКОВО в самому кінці відповіді постав одне конкретне уточнювальне питання. "
                "Уточни деталь, яка суттєво вплине на відповідь "
                "(статус особи, тип правовідносин, дата події або інша релевантна умова). "
                "Питання — окремим рядком після основної відповіді. Коротко і конкретно. Лише одне."
            )
        else:
            response_instructions.append(
                "Якщо є природне продовження теми або корисний наступний крок — "
                "постав одне коротке питання в кінці відповіді. "
                "Якщо відповідь повна і питання буде штучним — не питай."
            )

        # Length style: user preference takes priority. Avoid exact word counting for short mode;
        # format constraints produce a more natural compact answer.
        if is_short_response:
            response_instructions.append(
                "Не рахуй слова буквально. Орієнтуйся на компактність: відповідь має бути помітно коротшою за стандартну, "
                "але достатньою, щоб користувач зрозумів суть і наступний крок. Обов'язково завершуй речення."
            )
        else:
            _pref_limits = {"standard": 400, "detailed": 850, "full": 1600}
            _word_limit = _pref_limits[response_length_pref]
            response_instructions.append(
                f"Пиши завершену відповідь до {_word_limit} слів. "
                "Ніколи не обривай речення — якщо не вистачає місця, скорочуй менш важливі деталі, але завжди завершуй думку."
            )
            response_instructions.append(
                "КОНТРОЛЬ ОБСЯГУ: перед фінальним абзацом перевір, чи вкладаєшся в ліміт. "
                "Якщо місця мало, не додавай нові розділи — дай стислий висновок і заверши відповідь."
            )

        # Language style instruction
        if body.response_lang_style == "plain":
            response_instructions.append(
                "СТИЛЬ МОВИ: пиши простою зрозумілою мовою без юридичного жаргону. "
                "Замінюй складні терміни поясненнями. "
                "Уявляй що пояснюєш людині без юридичної освіти."
            )
        else:
            response_instructions.append(
                "СТИЛЬ МОВИ: використовуй точну юридичну мову, коректні назви НПА, процесуальні терміни "
                "і професійну структуру відповіді."
            )

        # Build user profile block if available
        profile_block = ""
        if body.user_profile:
            _role     = body.user_profile.get("role") or ""
            _sub_role = body.user_profile.get("sub_role") or []
            _segment  = body.user_profile.get("segment") or []
            _parts: list[str] = []
            if _role:
                _parts.append(f"Роль: {_role}")
            if _sub_role:
                _parts.append(f"Спеціалізація: {', '.join(_sub_role)}")
            if _segment:
                _parts.append(f"Сфери інтересів: {', '.join(_segment)}")
            if _parts:
                profile_block = "Профіль користувача:\n" + "\n".join(_parts) + "\n\n"

        # Build personal AI prompt block
        personal_block = ""
        if body.ai_personal_prompt and body.ai_personal_prompt.strip():
            personal_block = f"Персональний контекст користувача:\n{body.ai_personal_prompt.strip()[:800]}\n\n"

        # Build summary block (compressed older turns, generated every 3rd turn on frontend)
        summary_block = ""
        if body.context_summary and body.context_summary.strip():
            summary_block = f"Резюме попереднього діалогу:\n{body.context_summary.strip()[:4000]}\n\n"

        # Build conversation history block — last 3 turns (6 messages) only
        # Older turns are already covered by context_summary
        history_block = ""
        if body.history:
            recent = body.history[-6:]  # 6 повідомлень = 3 turns
            history_lines: list[str] = []
            for turn in recent:
                role = turn.get("role", "")
                content = (turn.get("content") or "").strip()[:800]  # cap per-turn
                if role == "user":
                    history_lines.append(f"Користувач: {content}")
                elif role == "assistant":
                    history_lines.append(f"Асистент: {content}")
            if history_lines:
                history_block = "Останні повідомлення діалогу:\n" + "\n".join(history_lines) + "\n\n"

        prompt = (
            f"{profile_block}"
            f"{personal_block}"
            f"{summary_block}"
            f"{history_block}"
            "Контекст з українського законодавства, структурований за правовою ієрархією:\n\n"
            f"{context}\n\n"
            f"---\nПитання: {question}\n\n"
            + " ".join(response_instructions)
        )

        clf_prompt = (
            f"Питання: {question}\n\n"
            "Проаналізуй і поверни JSON:\n"
            '{"sentiment": "neutral"|"urgent"|"frustrated", '
            '"complexity_score": 1|2|3, '
            '"user_intent": "консультація"|"документи"|"захист прав"|"роз\'яснення"}\n\n'
            "sentiment — емоційний стан: neutral (спокійний), urgent (терміново), frustrated (незадоволений).\n"
            "complexity_score — складність: 1 просте, 2 середнє, 3 складне/комплексне.\n"
            "user_intent — мета: консультація (загальне питання), документи (потрібен шаблон/форма), "
            "захист прав (суперечка/скарга), роз'яснення (просить пояснити поняття/закон)."
        )

        main_model = GenerativeModel(model_name, system_instruction=system_prompt)
        clf_model  = GenerativeModel(model_name)

        # thinking_budget=0: відповідь будується з готового контексту, thinking не потрібен
        try:
            from vertexai.generative_models import ThinkingConfig as _ThinkingConfig
            _main_gen_cfg = GenerationConfig(
                temperature=temperature, top_p=top_p, max_output_tokens=max_output_tokens,
                thinking_config=_ThinkingConfig(thinking_budget=0),
            )
        except Exception:
            _main_gen_cfg = GenerationConfig(temperature=temperature, top_p=top_p, max_output_tokens=max_output_tokens)

        llm_timeout = settings_cache.get_float("llm_timeout_seconds", 90.0)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI setup error: {e}")

    return {
        "prompt": prompt, "clf_prompt": clf_prompt,
        "citations": citations, "results": results, "low_confidence": low_confidence,
        "main_model": main_model, "clf_model": clf_model,
        "main_gen_cfg": _main_gen_cfg, "llm_timeout": llm_timeout,
        "start_time": start_time, "max_output_tokens": max_output_tokens,
    }


class SummarizeHistoryBody(BaseModel):
    messages: list[dict]          # [{role:"user"|"assistant", content:"..."}]
    existing_summary: str | None = None


@app.post("/summarize_history")
async def summarize_history_endpoint(body: SummarizeHistoryBody):
    """Стискає список повідомлень в короткий резюме (200-300 слів).
    Якщо є existing_summary — включає його в новий стислий контекст."""
    if not body.messages:
        return {"summary": body.existing_summary or ""}

    model_name = settings_cache.get("rewrite_model", "gemini-2.5-flash")
    from vertexai.generative_models import GenerativeModel, GenerationConfig
    try:
        from vertexai.generative_models import ThinkingConfig as _SumThinkingConfig
        _sum_gen_cfg = GenerationConfig(
            temperature=0.0, max_output_tokens=4000,
            thinking_config=_SumThinkingConfig(thinking_budget=0),
        )
    except Exception:
        _sum_gen_cfg = GenerationConfig(temperature=0.0, max_output_tokens=4000)

    lines: list[str] = []
    if body.existing_summary:
        lines.append(f"[Попереднє резюме]\n{body.existing_summary}\n")
    for turn in body.messages:
        role = turn.get("role", "")
        content = (turn.get("content") or "").strip()[:800]
        if role == "user":
            lines.append(f"Користувач: {content}")
        elif role == "assistant":
            lines.append(f"Асистент: {content}")

    dialogue_text = "\n".join(lines)
    prompt = (
        "Зроби стислий переказ наступного діалогу між юридичним асистентом і користувачем. "
        "Збережи ключові факти: про що запитував користувач, які закони або норми згадувалися, "
        "які висновки були зроблені, які уточнення вже поставлені та які відповіді вже надані. "
        "Не використовуй markdown-заголовки. Переказ має бути 250-450 слів, українською мовою.\n\n"
        f"{dialogue_text}\n\nСтислий переказ:"
    )

    try:
        import asyncio as _asyncio
        _sum_model = GenerativeModel(model_name)
        resp = await _asyncio.wait_for(
            _asyncio.to_thread(
                _sum_model.generate_content,
                prompt,
                generation_config=_sum_gen_cfg,
            ),
            timeout=20,
        )
        summary = ""
        try:
            summary = (resp.text or "").strip()
        except Exception:
            pass
        if not summary:
            # Fallback: non-thought parts
            try:
                summary = " ".join(
                    getattr(p, "text", "").strip()
                    for p in resp.candidates[0].content.parts
                    if not getattr(p, "thought", False) and getattr(p, "text", "")
                ).strip()
            except Exception:
                pass
        if not summary:
            raise ValueError("empty summary")
        return {"summary": summary}
    except Exception as e:
        logger.warning("summarize_history failed: %s", e)
        fallback = dialogue_text[:4000].strip()
        return {"summary": fallback}


@app.post("/ask")
async def ask(body: AskRequest):
    """Приймає питання → повертає відповідь від Gemini + посилання на закони."""
    import asyncio as _asyncio
    import json as _json
    from vertexai.generative_models import GenerationConfig

    pipe = await _ask_pipeline(body)
    if pipe.get("early_answer"):
        return pipe["early_answer"]

    try:
        response, clf_response = await _asyncio.wait_for(
            _asyncio.gather(
                _asyncio.to_thread(
                    pipe["main_model"].generate_content,
                    pipe["prompt"],
                    generation_config=pipe["main_gen_cfg"],
                ),
                _asyncio.to_thread(
                    pipe["clf_model"].generate_content,
                    pipe["clf_prompt"],
                    generation_config=GenerationConfig(temperature=0.0, response_mime_type="application/json"),
                ),
            ),
            timeout=pipe["llm_timeout"],
        )
    except _asyncio.TimeoutError:
        raise HTTPException(504, f"AI не відповів за {pipe['llm_timeout']:.0f}с — спробуйте пізніше")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI error: {e}")

    answer = response.text
    tokens_used = 0
    try:
        tokens_used = response.usage_metadata.total_token_count or 0
    except Exception:
        pass
    finish_reason = None
    try:
        finish_reason = response.candidates[0].finish_reason
        logger.info("FINISH_REASON: %s | tokens_used: %s | max_tokens: %s", finish_reason, tokens_used, pipe["max_output_tokens"])
        if _finish_reason_is_max_tokens(finish_reason):
            logger.warning("RESPONSE TRUNCATED by max_output_tokens=%s", pipe["max_output_tokens"])
    except Exception:
        pass

    answer = await _complete_answer_if_needed(pipe, answer, finish_reason)

    try:
        classification = _json.loads(clf_response.text)
        if classification.get("sentiment") not in ("neutral", "urgent", "frustrated"):
            classification["sentiment"] = "neutral"
        if classification.get("complexity_score") not in (1, 2, 3):
            classification["complexity_score"] = 1
        if classification.get("user_intent") not in ("консультація", "документи", "захист прав", "роз'яснення"):
            classification["user_intent"] = "консультація"
    except Exception:
        classification = dict(_CLF_FALLBACK)

    cats = [r["out_metadata"].get("category", "") for r in pipe["results"] if r["out_metadata"].get("category")]
    category = max(set(cats), key=cats.count) if cats else "Загальне"
    elapsed_ms = int((time.time() - pipe["start_time"]) * 1000)

    return {
        "answer": answer,
        "references": pipe["citations"],
        "templates": [],
        "_meta": {
            "processing_time_ms": elapsed_ms,
            "tokens_used": tokens_used,
            "category": category,
            "low_confidence": pipe["low_confidence"],
            "top_score": round(pipe["results"][0]["similarity"], 3) if pipe["results"] else 0.0,
            "n_docs": len(pipe["results"]),
            **classification,
        },
    }


@app.post("/ask_stream")
async def ask_stream(body: AskRequest):
    """SSE streaming версія /ask — токени стримуються одразу, citations event в кінці."""
    import asyncio as _asyncio
    import json as _json
    import threading as _threading
    from fastapi.responses import StreamingResponse as _SR

    async def generate():
        request_id = str(uuid.uuid4())

        def _sse(event: str, data: dict) -> str:
            return f"event: {event}\ndata: {_json.dumps(data, ensure_ascii=False)}\n\n"

        yield _sse("status", {
            "request_id": request_id,
            "step": "started",
            "message": "Прийняв питання. Готую пошук джерел.",
        })

        try:
            yield _sse("status", {
                "request_id": request_id,
                "step": "retrieval",
                "message": "Шукаю релевантні документи в базі.",
            })
            pipe = await _ask_pipeline(body)
        except HTTPException as exc:
            yield _sse("error", {
                "request_id": request_id,
                "error": exc.detail,
                "status": exc.status_code,
            })
            return
        except Exception as exc:
            logger.exception("ASK_STREAM pipeline failed")
            yield _sse("error", {
                "request_id": request_id,
                "error": "Backend pipeline failed",
                "detail": str(exc),
                "status": 500,
            })
            return

        if pipe.get("early_answer"):
            ea = pipe["early_answer"]
            yield _sse("citations", ea)
            return

        yield _sse("status", {
            "request_id": request_id,
            "step": "generation",
            "message": "Джерела знайдено. Формую відповідь.",
            "n_docs": len(pipe.get("results", [])),
            "low_confidence": bool(pipe.get("low_confidence")),
        })

        from vertexai.generative_models import GenerationConfig as _GC
        loop = _asyncio.get_event_loop()
        token_queue: _asyncio.Queue = _asyncio.Queue()
        answer_parts: list[str] = []
        stream_finish_reason = {"value": None}

        clf_task = _asyncio.create_task(
            _asyncio.to_thread(
                pipe["clf_model"].generate_content,
                pipe["clf_prompt"],
                generation_config=_GC(temperature=0.0, response_mime_type="application/json"),
            )
        )

        def _sync_stream():
            try:
                for chunk in pipe["main_model"].generate_content(
                    pipe["prompt"],
                    generation_config=pipe["main_gen_cfg"],
                    stream=True,
                ):
                    try:
                        try:
                            fr = chunk.candidates[0].finish_reason
                            if fr:
                                stream_finish_reason["value"] = fr
                        except Exception:
                            pass
                        text = chunk.text
                        if text:
                            _asyncio.run_coroutine_threadsafe(
                                token_queue.put(("token", text)), loop
                            ).result(timeout=10)
                    except Exception:
                        pass
            except Exception as exc:
                _asyncio.run_coroutine_threadsafe(
                    token_queue.put(("error", str(exc))), loop
                ).result(timeout=5)
            finally:
                _asyncio.run_coroutine_threadsafe(
                    token_queue.put(("done", None)), loop
                ).result(timeout=5)

        _threading.Thread(target=_sync_stream, daemon=True).start()

        while True:
            try:
                event_type, data = await _asyncio.wait_for(
                    token_queue.get(), timeout=pipe["llm_timeout"]
                )
            except _asyncio.TimeoutError:
                yield _sse("error", {
                    "request_id": request_id,
                    "error": "LLM timeout",
                })
                clf_task.cancel()
                return

            if event_type == "done":
                break
            elif event_type == "error":
                yield _sse("error", {
                    "request_id": request_id,
                    "error": data,
                })
                clf_task.cancel()
                return
            else:
                answer_parts.append(data)
                yield _sse("message", {"token": data})

        full_answer = "".join(answer_parts)
        completed_answer = await _complete_answer_if_needed(pipe, full_answer, stream_finish_reason["value"])
        if completed_answer != full_answer:
            continuation = completed_answer[len(full_answer):]
            if continuation:
                yield _sse("message", {"token": continuation})
                full_answer = completed_answer

        try:
            clf_response = await clf_task
            import json as __json
            classification = __json.loads(clf_response.text)
            if classification.get("sentiment") not in ("neutral", "urgent", "frustrated"):
                classification["sentiment"] = "neutral"
            if classification.get("complexity_score") not in (1, 2, 3):
                classification["complexity_score"] = 1
            if classification.get("user_intent") not in ("консультація", "документи", "захист прав", "роз'яснення"):
                classification["user_intent"] = "консультація"
        except Exception:
            classification = dict(_CLF_FALLBACK)

        cats = [r["out_metadata"].get("category", "") for r in pipe["results"] if r["out_metadata"].get("category")]
        category = max(set(cats), key=cats.count) if cats else "Загальне"
        elapsed_ms = int((time.time() - pipe["start_time"]) * 1000)

        citations_payload = {
            "answer": full_answer,
            "references": pipe["citations"],
            "templates": [],
            "_meta": {
                "processing_time_ms": elapsed_ms,
                "tokens_used": 0,
                "category": category,
                "low_confidence": pipe["low_confidence"],
                "top_score": round(pipe["results"][0]["similarity"], 3) if pipe["results"] else 0.0,
                "n_docs": len(pipe["results"]),
                **classification,
            },
        }
        yield _sse("citations", citations_payload)
        yield _sse("done", {"request_id": request_id})

    return _SR(generate(), media_type="text/event-stream",
               headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/ask_simple")
async def ask_simple(body: AskRequest):
    """A/B test endpoint — removed after test showed routing is necessary."""
    return {"answer": "Endpoint видалено після A/B тесту.", "references": [], "templates": [], "_meta": {}}


class GenerateNameRequest(BaseModel):
    question: str
    answer: str

@app.post("/generate-name")
async def generate_name(body: GenerateNameRequest):
    """Генерує назву та категорію чату через Vertex AI."""
    import asyncio as _asyncio
    from vertexai.generative_models import GenerativeModel, GenerationConfig
    import vertexai, json as _json

    creds    = settings_cache.get_credentials()
    project  = settings_cache.get_vertex_project()
    location = settings_cache.get_vertex_location()
    model_name = settings_cache.get("ai_model")
    vertexai.init(project=project, location=location, credentials=creds)

    prompt = (
        "Ти — юридичний асистент. Проаналізуй запит користувача та відповідь AI.\n\n"
        "Поверни СТРОГО JSON без жодного іншого тексту:\n"
        '{"title":"назва до 5 слів без лапок","category":"категорія права"}\n\n'
        "Категорії: Трудове, Кримінальне, Цивільне, ФОП/Бізнес, Сімейне, Нерухомість, Мобілізація, Захист прав, Інше\n\n"
        f"Запит: {body.question[:500]}\nВідповідь: {body.answer[:500]}"
    )

    try:
        model = GenerativeModel(model_name)
        response = await _asyncio.to_thread(
            model.generate_content,
            prompt,
            generation_config=GenerationConfig(temperature=0.3, max_output_tokens=60),
        )
        raw = response.text.replace("```json", "").replace("```", "").strip()
        parsed = _json.loads(raw)
        return {
            "title":    (parsed.get("title", "") or "")[:80],
            "category": (parsed.get("category", "") or "")[:50],
        }
    except Exception as e:
        raise HTTPException(500, f"generate-name error: {e}")


@app.post("/generate-user-prompt")
async def generate_user_prompt(body: GenerateUserPromptRequest):
    """Генерує персональний AI-промпт на основі профілю юзера з онбордингу."""
    import asyncio as _asyncio
    from vertexai.generative_models import GenerativeModel, GenerationConfig

    role_label = body.role or "не вказано"
    sub_role_label = ", ".join(body.sub_role) if body.sub_role else "не вказано"
    segment_label = ", ".join(body.segment) if body.segment else "не вказано"

    meta_prompt = (
        "Ти — система персоналізації AI-юриста. Згенеруй детальний персональний профіль "
        "для AI-асистента на основі даних користувача.\n\n"
        "Профіль повинен містити 5–7 речень і чітко описувати:\n"
        "1. Хто цей користувач, яка його роль і чим він займається у правовій сфері\n"
        "2. Який рівень юридичних знань у нього — чи можна вживати складну термінологію\n"
        "3. Які конкретні галузі права найбільш актуальні для нього\n"
        "4. Як саме треба подавати відповіді: стиль, деталізація, акценти\n"
        "5. Які практичні аспекти найважливіші (документи, ризики, строки тощо)\n\n"
        f"Дані користувача:\n"
        f"- Роль: {role_label}\n"
        f"- Спеціалізація: {sub_role_label}\n"
        f"- Сфери інтересів: {segment_label}\n\n"
        "Поверни ТІЛЬКИ текст профілю — суцільний параграф без заголовків, без JSON, без переліків. "
        "Обсяг: рівно 80–100 слів українською. Завжди завершуй думку повним реченням."
    )

    model_name = settings_cache.get("ai_model") or "gemini-2.5-flash"
    try:
        if not _vertex_initialized:
            _init_vertex_ai()
        model = GenerativeModel(model_name)
        response = await _asyncio.to_thread(
            model.generate_content,
            meta_prompt,
            generation_config=GenerationConfig(temperature=0.5, max_output_tokens=4096),
        )
        text = (response.text or "").strip()
        return {"prompt": text}
    except Exception as e:
        raise HTTPException(500, f"generate-user-prompt error: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# Enrich OpenData metadata (Rada + KMU)
# ══════════════════════════════════════════════════════════════════════════════

def _do_enrich_opendata(session_id: str, sources: list, force: bool = False) -> None:
    src = "enrich_opendata"
    log = _make_reindex_log_cb(src)
    try:
        _enrich_stop.clear()
        from enrich_opendata_meta import run_enrich
        run_enrich(log_callback=log, stop_event=_enrich_stop, sources=sources, force=force)
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_update_qdrant_meta(session_id: str, sources: list) -> None:
    src = "update_qdrant_meta"
    log = _make_reindex_log_cb(src)
    try:
        _qdrant_meta_stop.clear()
        from update_qdrant_meta import run_update_qdrant
        run_update_qdrant(log_callback=log, stop_event=_qdrant_meta_stop, sources=sources)
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_extract_text_cancellations(session_id: str, sources: list, dry_run: bool = True) -> None:
    src = "extract_text_cancellations"
    log = _make_reindex_log_cb(src)
    try:
        _text_cancel_stop.clear()
        from extract_text_cancellations import run_extract
        run_extract(log_callback=log, stop_event=_text_cancel_stop, sources=sources, dry_run=dry_run)
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_check_text_missing(session_id: str, limit: int | None = None) -> None:
    src = "check_text_missing"
    log = _make_reindex_log_cb(src)
    try:
        _text_missing_check_stop.clear()
        from extract_text_cancellations import run_check_missing_opendata
        run_check_missing_opendata(
            log_callback=log,
            stop_event=_text_missing_check_stop,
            limit=limit,
        )
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_scrape_text_missing_found(session_id: str, limit: int | None = None, force: bool = False) -> None:
    src = "scrape_text_missing_found"
    log = _make_reindex_log_cb(src)
    try:
        _text_missing_scrape_stop.clear()
        from extract_text_cancellations import run_scrape_found_missing
        run_scrape_found_missing(
            log_callback=log,
            stop_event=_text_missing_scrape_stop,
            limit=limit,
            force=force,
        )
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


def _do_apply_text_cancellations(session_id: str, sources: list) -> None:
    src = "apply_text_cancellations"
    log = _make_reindex_log_cb(src)
    try:
        _apply_text_cancel_stop.clear()
        from enrich_opendata_meta import run_apply_text_cancellations
        run_apply_text_cancellations(
            log_callback=log,
            stop_event=_apply_text_cancel_stop,
            sources=sources,
        )
    except Exception as e:
        log(f"Критична помилка: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


# ══════════════════════════════════════════════════════════════════════════════
# Pipeline — повний автоматичний цикл оновлення (6 кроків)
# ══════════════════════════════════════════════════════════════════════════════

_PIPELINE_STEP_NAMES = [
    "Скрапінг (нові документи)",
    "Реіндекс (тільки нові)",
    "Збагачення метаданих OpenData",
    "Видобування текстових скасувань",
    "Застосування текстового кешу",
    "Патч Qdrant payload",
]


def _pipeline_log(msg: str, level: str = "info") -> None:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "message": msg, "level": level}
    with _lock:
        _sync["pipeline"]["live_logs"].append(entry)
        if len(_sync["pipeline"]["live_logs"]) > MAX_LIVE_LOGS:
            _sync["pipeline"]["live_logs"] = _sync["pipeline"]["live_logs"][-MAX_LIVE_LOGS:]


def _load_pipeline_resume() -> dict:
    try:
        if _PIPELINE_RESUME_FILE.exists():
            return json.loads(_PIPELINE_RESUME_FILE.read_text("utf-8"))
    except Exception:
        pass
    return {"step1_done": [], "step2_done": []}


def _save_pipeline_resume(state: dict) -> None:
    try:
        _PIPELINE_RESUME_FILE.write_text(json.dumps(state, ensure_ascii=False), "utf-8")
    except Exception:
        pass


def _clear_pipeline_resume() -> None:
    try:
        if _PIPELINE_RESUME_FILE.exists():
            _PIPELINE_RESUME_FILE.unlink()
    except Exception:
        pass


def _do_pipeline(session_id: str) -> None:
    """6-step incremental sync pipeline. Each step runs sequentially; aborts on stop signal."""
    src = "pipeline"
    sources = list(_PIPELINE_SOURCES)
    step = 0

    def _step_log(msg: str, level: str = "info") -> None:
        _pipeline_log(f"[{step}/{len(_PIPELINE_STEP_NAMES)}] {msg}", level)

    def _stopped() -> bool:
        return _pipeline_stop.is_set()

    try:
        _pipeline_stop.clear()
        # Clear all per-source stop events from a previous stop press
        for _evt in _v2_scrape_stop.values():
            _evt.clear()

        # Load resume state — allows continuing from where we stopped
        resume = _load_pipeline_resume()
        step1_done = set(resume.get("step1_done", []))
        step2_done = set(resume.get("step2_done", []))
        if step1_done or step2_done:
            _pipeline_log(
                f"⏩ Відновлення: скрапінг виконано {sorted(step1_done)}, "
                f"реіндекс виконано {sorted(step2_done)}", "info"
            )
        _pipeline_log(f"🚀 Пайплайн розпочато: {session_id[:8]}", "info")

        # ── Step 1: Scrape (force=False, recent_pages=10 → only newest N pages) ──
        step = 1
        _step_log(f"▶ {_PIPELINE_STEP_NAMES[0]}")
        # rada/kmu have 2000+ pages each; in pipeline we only check the 10 most recent pages
        # (~500 docs) — new docs always appear on page 1 (sorted by last edition date desc).
        # mod/zir use different scrapers (Playwright) so they handle skip logic internally.
        PIPELINE_RECENT_PAGES = 10
        for scrape_src in sources:
            if _stopped():
                _step_log("⏸ Зупинено — прогрес збережено, запустіть знову щоб продовжити", "warning")
                return
            if scrape_src in step1_done:
                _pipeline_log(f"  ⏭ {scrape_src}: вже виконано (resume)", "info")
                continue
            try:
                stop_ev = _v2_scrape_stop[scrape_src]
                stop_ev.clear()
                if scrape_src == "mod":
                    from scrape_mod_v2 import run_scrape_mod
                    run_scrape_mod(log_callback=_pipeline_log, stop_event=stop_ev, force=False)
                elif scrape_src == "zir":
                    from scrape_zir_v2 import run_scrape_zir
                    run_scrape_zir(log_callback=_pipeline_log, stop_event=stop_ev, force=False,
                                   max_batches=PIPELINE_RECENT_PAGES)
                else:
                    from scrape_all_v2 import run_scrape_all
                    run_scrape_all(source=scrape_src, rada_collection=None,
                                   log_callback=_pipeline_log, stop_event=stop_ev,
                                   force=False, recent_pages=PIPELINE_RECENT_PAGES)
            except Exception as e:
                _step_log(f"⚠️ Scrape {scrape_src}: {e}", "warning")
            if not _stopped():
                step1_done.add(scrape_src)
                _save_pipeline_resume({"step1_done": sorted(step1_done), "step2_done": sorted(step2_done)})
        _step_log(f"✅ {_PIPELINE_STEP_NAMES[0]} завершено")

        # ── Step 2: Reindex new only ────────────────────────────────────────────
        step = 2
        _step_log(f"▶ {_PIPELINE_STEP_NAMES[1]}")
        if _stopped():
            _step_log("⏸ Зупинено — прогрес збережено, запустіть знову щоб продовжити", "warning")
            return
        for reindex_src in sources:
            if _stopped():
                _step_log("⏸ Зупинено — прогрес збережено, запустіть знову щоб продовжити", "warning")
                return
            if reindex_src in step2_done:
                _pipeline_log(f"  ⏭ {reindex_src}: вже виконано (resume)", "info")
                continue
            stop_key = reindex_src
            try:
                _v2_stop[stop_key].clear()
                from reindex_v2 import run_reindex_v2
                run_reindex_v2(source=reindex_src, log_callback=_pipeline_log,
                               stop_event=_v2_stop[stop_key], new_only=True)
            except Exception as e:
                _step_log(f"⚠️ Reindex {reindex_src}: {e}", "warning")
            if not _stopped():
                step2_done.add(reindex_src)
                _save_pipeline_resume({"step1_done": sorted(step1_done), "step2_done": sorted(step2_done)})
        _step_log(f"✅ {_PIPELINE_STEP_NAMES[1]} завершено")

        # ── Step 3: Enrich OpenData metadata ───────────────────────────────────
        step = 3
        _step_log(f"▶ {_PIPELINE_STEP_NAMES[2]}")
        if _stopped():
            _step_log("⏸ Зупинено", "warning")
            return
        try:
            _enrich_stop.clear()
            from enrich_opendata_meta import run_enrich
            run_enrich(log_callback=_pipeline_log, stop_event=_enrich_stop,
                       sources=["rada", "kmu"], force=False)
        except Exception as e:
            _step_log(f"⚠️ Enrich OpenData: {e}", "warning")
        _step_log(f"✅ {_PIPELINE_STEP_NAMES[2]} завершено")

        # ── Step 4: Extract text cancellations ─────────────────────────────────
        step = 4
        _step_log(f"▶ {_PIPELINE_STEP_NAMES[3]}")
        if _stopped():
            _step_log("⏸ Зупинено", "warning")
            return
        try:
            _text_cancel_stop.clear()
            from extract_text_cancellations import run_extract
            run_extract(log_callback=_pipeline_log, stop_event=_text_cancel_stop,
                        sources=["rada", "kmu"], dry_run=False)
        except Exception as e:
            _step_log(f"⚠️ Text extract: {e}", "warning")
        _step_log(f"✅ {_PIPELINE_STEP_NAMES[3]} завершено")

        # ── Step 5: Apply text cache ────────────────────────────────────────────
        step = 5
        _step_log(f"▶ {_PIPELINE_STEP_NAMES[4]}")
        if _stopped():
            _step_log("⏸ Зупинено", "warning")
            return
        try:
            _apply_text_cancel_stop.clear()
            from enrich_opendata_meta import run_apply_text_cancellations
            run_apply_text_cancellations(log_callback=_pipeline_log,
                                         stop_event=_apply_text_cancel_stop,
                                         sources=["rada", "kmu"])
        except Exception as e:
            _step_log(f"⚠️ Apply text cache: {e}", "warning")
        _step_log(f"✅ {_PIPELINE_STEP_NAMES[4]} завершено")

        # ── Step 6: Qdrant metadata patch ──────────────────────────────────────
        step = 6
        _step_log(f"▶ {_PIPELINE_STEP_NAMES[5]}")
        if _stopped():
            _step_log("⏸ Зупинено", "warning")
            return
        try:
            _qdrant_meta_stop.clear()
            from update_qdrant_meta import run_update_qdrant
            run_update_qdrant(log_callback=_pipeline_log, stop_event=_qdrant_meta_stop,
                              sources=["rada", "kmu"])
        except Exception as e:
            _step_log(f"⚠️ Qdrant patch: {e}", "warning")
        _step_log(f"✅ {_PIPELINE_STEP_NAMES[5]} завершено")

        # ── Done ────────────────────────────────────────────────────────────────
        run_ts = datetime.now(timezone.utc).isoformat()
        try:
            _PIPELINE_LAST_RUN_FILE.write_text(
                json.dumps({"ts": run_ts, "session_id": session_id}, ensure_ascii=False), "utf-8"
            )
        except Exception:
            pass
        _clear_pipeline_resume()
        _pipeline_log(f"🎉 Пайплайн завершено: {run_ts}", "info")

    except Exception as e:
        _pipeline_log(f"❌ Критична помилка пайплайну: {e}", "error")
    finally:
        with _lock:
            _sync[src]["running"] = False
            _sync[src]["pause_requested"] = False


@app.post("/admin/pipeline/trigger")
async def pipeline_trigger():
    session_id = str(uuid.uuid4())
    try:
        _start_sync("pipeline", _do_pipeline, session_id)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/pipeline/stop")
async def pipeline_stop_route():
    with _lock:
        if not _sync["pipeline"]["running"]:
            raise HTTPException(400, "Пайплайн не виконується")
        _pipeline_stop.set()
        # Also signal all per-source scrape stop events so the active scraper exits
        for _evt in _v2_scrape_stop.values():
            _evt.set()
        _sync["pipeline"]["pause_requested"] = True
    return {"ok": True}


@app.get("/admin/pipeline/status")
async def pipeline_status():
    with _lock:
        running   = _sync["pipeline"]["running"]
        pause_req = _sync["pipeline"]["pause_requested"]
        logs      = list(_sync["pipeline"]["live_logs"])
    last_run = None
    if _PIPELINE_LAST_RUN_FILE.exists():
        try:
            last_run = json.loads(_PIPELINE_LAST_RUN_FILE.read_text("utf-8")).get("ts")
        except Exception:
            pass
    return {
        "running":         running,
        "pause_requested": pause_req,
        "live_logs":       logs,
        "last_run":        last_run,
        "step_names":      _PIPELINE_STEP_NAMES,
    }


@app.post("/admin/enrich/start")
async def enrich_start(body: dict = Body(default={})):
    sources = body.get("sources") or ["rada", "kmu"]
    force   = bool(body.get("force", False))
    session_id = str(uuid.uuid4())
    try:
        _start_sync("enrich_opendata", _do_enrich_opendata, session_id,
                    sources=sources, force=force)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/enrich/stop")
async def enrich_stop_route():
    with _lock:
        if not _sync["enrich_opendata"]["running"]:
            raise HTTPException(400, "Збагачення не виконується")
        _enrich_stop.set()
        _sync["enrich_opendata"]["pause_requested"] = True
    return {"ok": True}


@app.post("/admin/enrich/text/start")
async def enrich_text_start(body: dict = Body(default={})):
    sources = body.get("sources") or ["rada", "kmu"]
    dry_run = bool(body.get("dry_run", True))
    session_id = str(uuid.uuid4())
    try:
        _start_sync(
            "extract_text_cancellations",
            _do_extract_text_cancellations,
            session_id,
            sources=sources,
            dry_run=dry_run,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id, "dry_run": dry_run}


@app.post("/admin/enrich/text/stop")
async def enrich_text_stop():
    with _lock:
        if not _sync["extract_text_cancellations"]["running"]:
            raise HTTPException(400, "Text cancellation extraction is not running")
        _text_cancel_stop.set()
        _sync["extract_text_cancellations"]["pause_requested"] = True
    return {"ok": True}


@app.post("/admin/enrich/text/check-missing/start")
async def enrich_text_check_missing_start(body: dict = Body(default={})):
    limit_raw = body.get("limit")
    limit = int(limit_raw) if limit_raw else None
    session_id = str(uuid.uuid4())
    try:
        _start_sync(
            "check_text_missing",
            _do_check_text_missing,
            session_id,
            limit=limit,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id, "limit": limit}


@app.post("/admin/enrich/text/check-missing/stop")
async def enrich_text_check_missing_stop():
    with _lock:
        if not _sync["check_text_missing"]["running"]:
            raise HTTPException(400, "Missing OpenData check is not running")
        _text_missing_check_stop.set()
        _sync["check_text_missing"]["pause_requested"] = True
    return {"ok": True}


@app.post("/admin/enrich/text/scrape-found/start")
async def enrich_text_scrape_found_start(body: dict = Body(default={})):
    limit_raw = body.get("limit")
    limit = int(limit_raw) if limit_raw else None
    force = bool(body.get("force", False))
    session_id = str(uuid.uuid4())
    try:
        _start_sync(
            "scrape_text_missing_found",
            _do_scrape_text_missing_found,
            session_id,
            limit=limit,
            force=force,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id, "limit": limit, "force": force}


@app.post("/admin/enrich/text/scrape-found/stop")
async def enrich_text_scrape_found_stop():
    with _lock:
        if not _sync["scrape_text_missing_found"]["running"]:
            raise HTTPException(400, "Scrape found missing is not running")
        _text_missing_scrape_stop.set()
        _sync["scrape_text_missing_found"]["pause_requested"] = True
    return {"ok": True}


@app.post("/admin/enrich/text/apply-cache/start")
async def enrich_text_apply_cache_start(body: dict = Body(default={})):
    sources = body.get("sources") or ["rada", "kmu"]
    session_id = str(uuid.uuid4())
    try:
        _start_sync(
            "apply_text_cancellations",
            _do_apply_text_cancellations,
            session_id,
            sources=sources,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/enrich/text/apply-cache/stop")
async def enrich_text_apply_cache_stop():
    with _lock:
        if not _sync["apply_text_cancellations"]["running"]:
            raise HTTPException(400, "Apply text cache is not running")
        _apply_text_cancel_stop.set()
        _sync["apply_text_cancellations"]["pause_requested"] = True
    return {"ok": True}


@app.get("/admin/enrich/text/report")
async def enrich_text_report(
    kind: str = "missing",
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    allowed = {
        "missing": "text_cancellations_missing_report.json",
        "partial": "text_cancellations_partial_report.json",
        "opendata": "text_cancellations_missing_opendata_report.json",
    }
    if kind not in allowed:
        raise HTTPException(400, f"kind must be one of {list(allowed)}")
    path = Path(__file__).parent / allowed[kind]
    if not path.exists():
        return {"kind": kind, "items": [], "total": 0, "summary": {}, "exists": False}
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(500, f"Cannot read report: {e}")

    records = report.get("records")
    if records is None:
        records = report.get("results") or report.get("scrape_candidates") or []
    from urllib.parse import unquote

    def decode_report_item(item):
        if not isinstance(item, dict):
            return item
        out = dict(item)
        for key in ("cancelled_nreg", "raw_cancelled_nreg", "nreg", "by"):
            if isinstance(out.get(key), str):
                out[key] = unquote(out[key])
        return out

    records = [decode_report_item(item) for item in records]
    if status:
        records = [item for item in records if isinstance(item, dict) and item.get("status") == status]
    total = len(records)
    summary = {
        "generated_at": report.get("generated_at"),
        "kind": report.get("kind", kind),
        "total_records": report.get("total_records", total),
        "unique_nregs": report.get("unique_nregs"),
        "stats": report.get("stats", {}),
        "found_count": report.get("found_count"),
        "top": report.get("top", [])[:20],
    }
    return {
        "kind": kind,
        "exists": True,
        "summary": summary,
        "items": records[offset: offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@app.get("/admin/enrich/status")
async def enrich_status():
    with _lock:
        s = dict(_sync["enrich_opendata"])
        logs = list(s.get("live_logs", []))
        qdm = dict(_sync["update_qdrant_meta"])
        qdm_logs = list(qdm.get("live_logs", []))
        text_cancel = dict(_sync["extract_text_cancellations"])
        text_cancel_logs = list(text_cancel.get("live_logs", []))
        text_missing = dict(_sync["check_text_missing"])
        text_missing_logs = list(text_missing.get("live_logs", []))
        text_scrape = dict(_sync["scrape_text_missing_found"])
        text_scrape_logs = list(text_scrape.get("live_logs", []))
        text_apply = dict(_sync["apply_text_cancellations"])
        text_apply_logs = list(text_apply.get("live_logs", []))

    state_file = Path(__file__).parent / "enrich_opendata_state.json"
    state = {}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    qdrant_state_file = Path(__file__).parent / "update_qdrant_meta_state.json"
    qdrant_state = {}
    if qdrant_state_file.exists():
        try:
            qdrant_state = json.loads(qdrant_state_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    text_state_file = Path(__file__).parent / "text_cancellations_state.json"
    text_state = {}
    if text_state_file.exists():
        try:
            text_state = json.loads(text_state_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    text_missing_state_file = Path(__file__).parent / "text_cancellations_missing_opendata_state.json"
    text_missing_state = {}
    if text_missing_state_file.exists():
        try:
            text_missing_state = json.loads(text_missing_state_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    text_scrape_state_file = Path(__file__).parent / "text_cancellations_scrape_found_state.json"
    text_scrape_state = {}
    if text_scrape_state_file.exists():
        try:
            text_scrape_state = json.loads(text_scrape_state_file.read_text(encoding="utf-8"))
        except Exception:
            pass

    return {
        "enrich": {
            "running":         s.get("running", False),
            "pause_requested": s.get("pause_requested", False),
            "live_logs":       logs,
            "state":           state,
        },
        "qdrant_meta": {
            "running":         qdm.get("running", False),
            "pause_requested": qdm.get("pause_requested", False),
            "live_logs":       qdm_logs,
            "state":           qdrant_state,
        },
        "text_cancellations": {
            "running":         text_cancel.get("running", False),
            "pause_requested": text_cancel.get("pause_requested", False),
            "live_logs":       text_cancel_logs,
            "state":           text_state,
        },
        "text_missing_check": {
            "running":         text_missing.get("running", False),
            "pause_requested": text_missing.get("pause_requested", False),
            "live_logs":       text_missing_logs,
            "state":           text_missing_state,
        },
        "text_missing_scrape": {
            "running":         text_scrape.get("running", False),
            "pause_requested": text_scrape.get("pause_requested", False),
            "live_logs":       text_scrape_logs,
            "state":           text_scrape_state,
        },
        "text_apply_cache": {
            "running":         text_apply.get("running", False),
            "pause_requested": text_apply.get("pause_requested", False),
            "live_logs":       text_apply_logs,
            "state":           {},
        },
    }


@app.post("/admin/enrich/qdrant/apply")
async def enrich_qdrant_apply(body: dict = Body(default={})):
    sources = body.get("sources") or ["rada", "kmu"]
    session_id = str(uuid.uuid4())
    try:
        _start_sync("update_qdrant_meta", _do_update_qdrant_meta, session_id,
                    sources=sources)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"ok": True, "session_id": session_id}


@app.post("/admin/enrich/qdrant/stop")
async def enrich_qdrant_stop():
    with _lock:
        if not _sync["update_qdrant_meta"]["running"]:
            raise HTTPException(400, "Патч Qdrant не виконується")
        _qdrant_meta_stop.set()
        _sync["update_qdrant_meta"]["pause_requested"] = True
    return {"ok": True}


@app.get("/admin/meta/list")
async def meta_list(
    source: str = "rada",
    dead: str | None = None,
    doc_type: str | None = None,
    theme: str | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    """Повертає список збагачених meta.json для перегляду в адмін панелі."""
    raw_base = Path("/root/laws_raw") / source
    if not raw_base.exists():
        return {"items": [], "total": 0, "source": source}

    items = []
    for meta_path in sorted(raw_base.glob("*.meta.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        if "rada_enriched_at" not in meta:
            continue

        # Filters
        if dead == "true" and not meta.get("rada_is_dead"):
            continue
        if dead == "false" and meta.get("rada_is_dead"):
            continue
        if doc_type and meta.get("rada_doc_type") != doc_type:
            continue
        if theme and theme not in (meta.get("rada_theme") or ""):
            continue
        if q:
            q_lower = q.lower()
            title = (meta.get("rada_title") or "").lower()
            nreg  = (meta.get("rada_nreg")  or "").lower()
            if q_lower not in title and q_lower not in nreg:
                continue

        items.append({
            "nreg":          meta.get("rada_nreg", meta_path.name.replace(".meta.json", "")),
            "title":         meta.get("rada_title", ""),
            "doc_type":      meta.get("rada_doc_type", ""),
            "status":        meta.get("rada_status", 0),
            "status_name":   meta.get("rada_status_name", ""),
            "is_dead":       meta.get("rada_is_dead", False),
            "dead_by_status":meta.get("rada_is_dead_by_status", False),
            "dead_by_link":  meta.get("rada_is_dead_by_link", False),
            "dead_by_text":  meta.get("rada_is_dead_by_text", False),
            "no_text":       meta.get("rada_no_text", False),
            "adopted_date":  meta.get("rada_adopted_date", ""),
            "last_edition":  meta.get("rada_last_edition", ""),
            "dead_since":    meta.get("rada_dead_since", ""),
            "replaced_by":   meta.get("rada_replaced_by", []),
            "cancelled_by":  meta.get("rada_cancelled_by", []),
            "cancelled_by_text": meta.get("rada_cancelled_by_text", []),
            "theme":         meta.get("rada_theme", ""),
            "classifiers":   meta.get("rada_classifiers", []),
            "org":           meta.get("rada_org", ""),
            "editions_cnt":  meta.get("rada_editions_cnt", 0),
            "url":           meta.get("rada_url", ""),
            "enriched_at":   meta.get("rada_enriched_at", ""),
        })

    total = len(items)
    return {
        "items":  items[offset: offset + limit],
        "total":  total,
        "source": source,
    }


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
