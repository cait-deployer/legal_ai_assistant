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
import logging
from concurrent.futures import ThreadPoolExecutor as _TPE

logger = logging.getLogger("uvicorn.error")
from datetime import datetime, timezone, timedelta
from pathlib import Path
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
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

# ── Supabase ───────────────────────────────────────────────────────────────────
_SB_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
_SB_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)

# ── In-memory стан по кожному джерелу ─────────────────────────────────────────
_SOURCES = ("rada", "supreme", "wiki", "templates", "ccu", "lpd", "kmu")
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
    processed = 0

    try:
        from qdrant_storage import (
            get_all_existing_laws_meta, delete_law_chunks, upload_to_qdrant,
            get_collection_for_category,
        )
        from rada_scanner import get_all_legal_ids, get_law_text, get_law_metadata, detect_text_flags, BASE
        from langchain_text_splitters import MarkdownTextSplitter
        from rada_to_supabase import embeddings

        splitter = MarkdownTextSplitter(chunk_size=1500, chunk_overlap=200)

        # 1. Отримуємо список законів (або з кешу при resume)
        if all_laws_cached is not None:
            all_laws = all_laws_cached
            log(f"📋 Список завантажено з кешу: {len(all_laws)} законів")
        else:
            log("📡 Сканування розділів Ради...")
            all_laws = get_all_legal_ids(section_codes=section_codes, log=log)
            log(f"📦 Знайдено: {len(all_laws)} унікальних законів")

        # 2. Метадані існуючих — окремо по кожній РАДА-колекції
        # Дозволяємо одному закону бути в кількох колекціях одночасно:
        # дедуплікація перевіряє лише цільову колекцію, а не всі.
        log("🔍 Завантаження метаданих Qdrant...")
        from qdrant_storage import RADA_COLLECTIONS, get_existing_laws_meta as _get_col_meta
        existing_by_col: dict[str, dict] = {}
        with _TPE(max_workers=6) as _ex_meta:
            _meta_futures = {_ex_meta.submit(_get_col_meta, col): col for col in RADA_COLLECTIONS}
            for _f in _meta_futures:
                existing_by_col[_meta_futures[_f]] = _f.result()
        total_existing = sum(len(v) for v in existing_by_col.values())
        log(f"📊 В базі вже: {total_existing} записів по {len(existing_by_col)} колекціях")

        total = len(all_laws)

        # Захист від дублікатів при паралельній обробці:
        # один закон може зустрічатись у кількох розділах Ради одночасно.
        _in_progress: set[str] = set()
        _in_progress_lock = threading.Lock()

        # ── Функція обробки одного закону (виконується в потоці) ──────────
        def _process_law(i: int) -> int:
            """Повертає 1 якщо закон оброблено, 0 якщо пропущено."""
            law       = all_laws[i]
            law_id    = law["id"]
            law_title = law["title"]
            category  = law["category"]
            law_url   = f"{BASE}/laws/show/{law_id}"
            coll      = get_collection_for_category(category)

            # Захист від дублікатів: якщо інший потік вже обробляє цей (закон, колекція) — пропускаємо.
            # Ключ — пара (law_id, coll), щоб той самий закон міг паралельно йти в різні колекції.
            _ip_key = (law_id, coll)
            with _in_progress_lock:
                if _ip_key in _in_progress:
                    log(f"  ⏭ [{i + 1}] {law_id}/{coll} — вже обробляється паралельним потоком")
                    return 0
                _in_progress.add(_ip_key)

            try:
                # Дедуплікація — перевіряємо лише в цільовій колекції.
                # Якщо закон є в іншій колекції — ок, додаємо ще раз у поточну.
                col_meta = existing_by_col.get(coll, {})
                if law_id in col_meta:
                    meta        = col_meta[law_id]
                    stored_date = meta.get("effective_date", "")
                    list_date   = law.get("list_date", "")
                    if stored_date and list_date:
                        if stored_date == list_date:
                            log(f"  ⏭ [{i + 1}] {law_id} — вже є в {coll} (дата {stored_date})")
                            return 0
                        log(f"🔄 Нова редакція {law_id} в {coll}: {stored_date} → {list_date}")
                        delete_law_chunks(law_id, coll)
                    else:
                        try:
                            last_str = meta.get("scraped_at", "").replace("Z", "+00:00")
                            last = datetime.fromisoformat(last_str)
                            now  = datetime.now(timezone.utc) if last.tzinfo else datetime.now()
                            if (now - last).days < 7:
                                log(f"  ⏭ [{i + 1}] {law_id} — в {coll} скраповано {(now - last).days} дн. тому")
                                return 0
                            log(f"🔄 Оновлення: {law_id} в {coll} (вік: {(now - last).days} дн.)")
                            delete_law_chunks(law_id, coll)
                        except Exception:
                            pass

                log(f"[{i + 1}/{total}] {law_title[:60]}")

                # Паралельний fetch: текст + метадані з семафором на rada.gov.ua
                def _fetch_text():
                    with _rada_http_sem:
                        return get_law_text(law_id)

                def _fetch_meta():
                    with _rada_http_sem:
                        return get_law_metadata(law_id)

                with _TPE(max_workers=2) as ex:
                    text_f = ex.submit(_fetch_text)
                    meta_f = ex.submit(_fetch_meta)
                    text     = text_f.result()
                    law_meta = meta_f.result()

                scraped_at = datetime.now(timezone.utc).isoformat()

                if text == "__RESTRICTED__":
                    log(f"  🔒 ДСК — зберігаємо без тексту", "warning")
                    try:
                        v = embeddings.embed_query(law_title)
                        upload_to_qdrant("", {
                            "source": law_title, "law_id": law_id, "category": category,
                            "status": "ДСК", "law_url": law_url,
                            "source_domain": "zakon.rada.gov.ua",
                            "scraped_at": scraped_at,
                            "effective_date": law.get("list_date", ""),
                            "chunk_index": 0,
                        }, v, coll, session_id=session_id)
                    except Exception as e:
                        log(f"  ❌ ДСК upload: {e}", "error")
                    return 1

                if not text:
                    log(f"  ⚠️ Порожній текст ({law_id}) — пропускаємо", "warning")
                    return 0

                chunks     = splitter.split_text(text)
                text_flags = detect_text_flags(text)
                log(f"  ✂️ {len(chunks)} чанків | {law_meta['status']} | {coll}")

                # Batch embed — по 5 чанків за раз (уникаємо ліміту токенів Google API)
                vectors = []
                try:
                    for b in range(0, len(chunks), 5):
                        vectors.extend(embeddings.embed_documents(chunks[b:b + 5]))
                except Exception as e:
                    log(f"  ⚠️ Batch embed помилка, перемикаємось на посткові: {e}", "warning")
                    vectors = []
                    for chunk in chunks:
                        try:
                            vectors.append(embeddings.embed_query(chunk))
                        except Exception as e2:
                            log(f"  ❌ embed_query: {e2}", "error")
                            vectors.append(None)
                if not vectors:
                    return 0

                base = {
                    "source": law_title, "law_id": law_id, "category": category,
                    "status": law_meta["status"], "law_url": law_url,
                    "source_domain": "zakon.rada.gov.ua", "scraped_at": scraped_at,
                    "effective_date": law.get("list_date", ""),
                    "doc_type": law_meta.get("doc_type", ""),
                    "author": law_meta.get("author", ""),
                    "superseded_by": law_meta.get("superseded_by", ""),
                    **text_flags,
                }
                for j, (chunk, vector) in enumerate(zip(chunks, vectors)):
                    if vector is None:
                        continue
                    try:
                        upload_to_qdrant(chunk, {**base, "chunk_index": j}, vector, coll, session_id=session_id)
                    except Exception as e:
                        log(f"  ❌ Чанк {j}: {e}", "error")

                log(f"  ✅ [{i + 1}/{total}] готово", "success")
                return 1
            finally:
                with _in_progress_lock:
                    _in_progress.discard(_ip_key)

        # ── Батч-паралельний цикл ─────────────────────────────────────────
        i = start_index
        while i < total:

            # Перевірка паузи між батчами
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

            # Формуємо батч
            batch_end   = min(i + RADA_WORKERS, total)
            batch_range = list(range(i, batch_end))
            log(f"⚡ Батч законів {i + 1}–{batch_end} / {total} ({RADA_WORKERS} потоків)")

            with _TPE(max_workers=RADA_WORKERS) as pool:
                from concurrent.futures import as_completed
                futs = {pool.submit(_process_law, idx): idx for idx in batch_range}
                for fut in as_completed(futs):
                    try:
                        processed += fut.result()
                    except Exception as e:
                        log(f"  ❌ Воркер: {e}", "error")

            i = batch_end

            # Зберігаємо прогрес і лічильник після кожного батча
            _save_state(src, all_laws, i, session_id)
            with _lock:
                _sync[src]["laws_processed"] = processed
            if processed % 10 < RADA_WORKERS:
                _sb_update_log(session_id, laws_processed=processed)

            # Пауза між батчами — ввічливо до rada.gov.ua
            time.sleep(1.0)

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
    _init_vertex_ai()

    # Створюємо всі Qdrant колекції якщо їх немає (безпечно — існуючі пропускає)
    try:
        from qdrant_storage import init_all_collections, ensure_text_indexes
        import threading as _threading
        init_all_collections()
        print("✅ Qdrant collections ready.")
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
        from rada_to_supabase import embeddings
        from qdrant_storage import search_qdrant, ALL_COLLECTIONS
        import asyncio as _aio
        q_vec = await _aio.to_thread(embeddings.embed_query, q)
        collections = _route_collections(q, ALL_COLLECTIONS, q_vec)
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
            from qdrant_storage import ALL_COLLECTIONS
            new_centroids = await asyncio.to_thread(_compute_centroids, ALL_COLLECTIONS)
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
                    collection_name="laws_supreme",
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
        "total_requests", "session_count", "subscription_tier",
    }
    if sort_by not in _ALLOWED_SORT:
        sort_by = "created_at"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    select_cols = (
        "id,email,full_name,avatar_url,subscription_tier,"
        "is_onboarded,email_confirmed,trial_used,"
        "last_active_at,last_city,last_country,last_country_code,"
        "auth_provider,requests_this_month,monthly_limit,"
        "total_requests,session_count,avg_session_duration,"
        "created_at,last_ip,user_agent,marketing_consent,limit_reset_at,"
        "role,sub_role,segment,ai_personal_prompt"
    )

    params: dict = {
        "select": select_cols,
        "order": f"{sort_by}.{sort_dir}.nullslast",
        "limit": str(per_page),
        "offset": str((page - 1) * per_page),
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
        from qdrant_storage import get_client, RADA_COLLECTIONS

        client = get_client()
        must = [FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        if category:
            must.append(FieldCondition(key="category", match=MatchValue(value=category)))
        scroll_filter = Filter(must=must)

        all_points: list = []
        for col in RADA_COLLECTIONS:
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
        from qdrant_storage import get_client, ALL_COLLECTIONS

        client = get_client()
        all_chunks: list = []
        # Шукаємо по всіх колекціях — law_id унікальний
        for col in ALL_COLLECTIONS:
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
        from qdrant_storage import get_client, RADA_COLLECTIONS, ALL_COLLECTIONS

        client = get_client()

        must = [FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        if category:
            must.append(FieldCondition(key="category", match=MatchValue(value=category)))
        scroll_filter = Filter(must=must)

        # Вибираємо колекції відповідно до фільтру source
        if source == "rada":
            target_cols = RADA_COLLECTIONS
        elif source == "supreme":
            target_cols = ["laws_supreme"]
        elif source == "wiki":
            target_cols = ["laws_wiki"]
        elif source == "ccu":
            target_cols = ["laws_ccu"]
        elif source == "lpd":
            target_cols = ["laws_positions"]
        elif source == "kmu":
            target_cols = ["laws_kmu"]
        else:
            target_cols = ALL_COLLECTIONS

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
        from qdrant_storage import get_client, RADA_COLLECTIONS

        client = get_client()
        scroll_filter = Filter(must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))])

        categories: set[str] = set()
        for col in RADA_COLLECTIONS:
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
    from qdrant_storage import get_client, RADA_COLLECTIONS
    from rada_scanner import ALL_THEMES, get_section_doc_count

    # ── 1. Qdrant: збираємо chunk_index=0 по всіх РАДА-колекціях ──
    client = get_client()
    qdrant_filter = Filter(must=[
        FieldCondition(key="chunk_index",   match=MatchValue(value=0)),
        FieldCondition(key="source_domain", match=MatchValue(value="zakon.rada.gov.ua")),
    ])

    all_points: list = []
    for col in RADA_COLLECTIONS:
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
        ("laws_positions", "Правові позиції Верховного Суду", "lpd"),
        ("laws_ccu",       "Конституційний суд України",      "ccu"),
        ("laws_wiki",      "Вікіпедія — правові статті",      "wiki"),
        ("laws_supreme",   "Верховний суд України",            "supreme"),
        ("laws_kmu",       "Кабінет Міністрів України",        "kmu"),
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
_ALWAYS_INCLUDE = {"laws_positions", "laws_supreme", "laws_kmu"}

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
            from qdrant_storage import ALL_COLLECTIONS
            _centroids = _compute_centroids(ALL_COLLECTIONS)

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
    Fallback → ALL_COLLECTIONS якщо центроїди недоступні.
    """
    try:
        centroids = _load_centroids()
        if not centroids:
            return list(all_collections)

        if query_vector is None:
            from rada_to_supabase import embeddings as _emb
            q_vec = _emb.embed_query(question)
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

# Маппінг галузі → колекції Qdrant
_INTENT_MAP: dict[str, list[str]] = {
    "трудове":           ["rada_labor", "laws_kmu", "laws_positions", "laws_supreme"],
    "податкове":         ["rada_finance", "laws_kmu", "laws_positions", "laws_supreme"],
    "фінансове":         ["rada_finance", "laws_kmu", "laws_positions", "laws_supreme"],
    "цивільне":          ["rada_civil", "laws_positions", "laws_supreme"],
    "кримінальне":       ["rada_criminal", "laws_positions", "laws_supreme", "laws_ccu"],
    "адміністративне":   ["rada_admin", "rada_state", "laws_positions", "laws_supreme"],
    "земельне":          ["rada_land", "laws_kmu", "laws_positions"],
    "житлове":           ["rada_housing", "laws_kmu", "laws_positions"],
    "корпоративне":      ["rada_civil", "rada_finance", "laws_positions", "laws_supreme"],
    "міжнародне":        ["rada_intl", "laws_positions", "laws_supreme"],
    "кадрове":           ["rada_personnel", "rada_labor", "laws_kmu", "laws_positions"],
    "судове":            ["laws_positions", "laws_supreme", "laws_ccu", "rada_court"],
    "інше":              None,  # fallback → всі колекції
}

async def _classify_and_route(question: str, all_cols: list[str]) -> list[str]:
    """Класифікує галузь права через Gemini → повертає список колекцій для пошуку."""
    import asyncio as _asyncio
    try:
        from vertexai.generative_models import GenerativeModel, GenerationConfig
        _m = GenerativeModel(_model_name)
        prompt = (
            "Визнач галузь права для цього юридичного питання.\n"
            "Відповідь — ОДНЕ слово зі списку:\n"
            "трудове / податкове / фінансове / цивільне / кримінальне / "
            "адміністративне / земельне / житлове / корпоративне / "
            "міжнародне / кадрове / судове / інше\n\n"
            f"Питання: {question}\n\nГалузь:"
        )
        resp = await _asyncio.to_thread(
            _m.generate_content, prompt,
            generation_config=GenerationConfig(temperature=0.0, max_output_tokens=10),
        )
        intent = resp.text.strip().lower().rstrip(".")
        cols = _INTENT_MAP.get(intent)
        if cols:
            # Фільтруємо тільки ті що існують в all_cols
            result = [c for c in cols if c in all_cols]
            logger.info("INTENT '%s' → collections: %s", intent, result)
            return result if result else all_cols
        else:
            logger.info("INTENT '%s' → fallback all collections", intent)
            return all_cols
    except Exception as e:
        logger.info("INTENT classifier failed (%s) → fallback all collections", e)
        return all_cols


# ── /ask — основний чат-ендпоінт ──────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    max_docs: int = 12                         # max chunks from Qdrant (from user's plan)
    filter_domains: list[str] | None = None    # kept for backward compat (unused)
    filter_sources: list[str] | None = None    # e.g. ["rada", "wiki", "supreme", "ccu"]
    response_features: list[str] = []          # enabled response quality features from plan
    user_profile: dict | None = None           # {role, sub_role, segment} from onboarding
    history: list[dict] | None = None          # [{role:"user"|"assistant", content:"..."}]
    ai_personal_prompt: str | None = None      # персональний AI-профіль юзера (з налаштувань)


class GenerateUserPromptRequest(BaseModel):
    role: str | None = None
    sub_role: list[str] = []
    segment: list[str] = []


_CLF_FALLBACK = {"sentiment": "neutral", "complexity_score": 1, "user_intent": "консультація"}


@app.post("/ask")
async def ask(body: AskRequest):
    """Приймає питання → повертає відповідь від Gemini + посилання на закони."""
    import asyncio as _asyncio

    start_time = time.time()
    question = body.question.strip()
    if not question:
        raise HTTPException(400, "question is required")

    # 1. Ініціалізація + embed query + HyDE гіпотетична відповідь (паралельно)
    try:
        from rada_to_supabase import embeddings
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
                _tr_resp = await __import__("asyncio").to_thread(
                    _tr_model.generate_content,
                    f"Переклади на українську мову. Відповідь — тільки переклад без пояснень:\n\n{question}",
                    generation_config=GenerationConfig(temperature=0.0, max_output_tokens=300),
                )
                search_question = _tr_resp.text.strip() or question
                logger.info("RU→UA: %s → %s", question[:60], search_question[:60])
            except Exception:
                pass  # fallback — шукаємо оригінальним текстом

        async def _gen_hypothetical() -> str | None:
            """HyDE: генеруємо гіпотетичний уривок закону по стилю бази."""
            try:
                _m = GenerativeModel(_model_name)
                resp = await _asyncio.to_thread(
                    _m.generate_content,
                    (
                        "Ти — юрист. Напиши 2-3 речення офіційного юридичного тексту "
                        "з українського законодавства, який відповідає на питання нижче. "
                        "Використовуй юридичну термінологію і стиль нормативних актів. "
                        "Тільки текст, без пояснень і заголовків.\n\n"
                        f"Питання: {question}"
                    ),
                    generation_config=GenerationConfig(temperature=0.1, max_output_tokens=200),
                )
                text = resp.text.strip()
                logger.info("HYDE generated: %s", text[:300])
                return text
            except Exception as e:
                logger.info("HYDE failed: %s", e)
                return None

        # Embed питання (перекладеного якщо треба) + генеруємо гіпотетичну відповідь — одночасно
        query_vector, hypothetical_text = await _asyncio.gather(
            _asyncio.to_thread(embeddings.embed_query, search_question),
            _gen_hypothetical(),
        )
        logger.info("QUERY: %s", search_question[:200])
    except Exception as e:
        raise HTTPException(500, f"Embedding/HyDE error: {e}")

    # 2. Визначаємо колекції
    from qdrant_storage import search_qdrant, RADA_COLLECTIONS, ALL_COLLECTIONS

    if body.filter_sources:
        # Явний фільтр від юзера/плану — поважаємо його вибір
        allowed = set(body.filter_sources)
        target_collections: list[str] = []
        if "rada" in allowed:
            target_collections += RADA_COLLECTIONS
        if "supreme" in allowed:
            target_collections.append("laws_supreme")
        if "wiki" in allowed:
            target_collections.append("laws_wiki")
        if "ccu" in allowed:
            target_collections.append("laws_ccu")
        if "lpd" in allowed:
            target_collections.append("laws_positions")
        if "kmu" in allowed:
            target_collections.append("laws_kmu")
        if not target_collections:
            target_collections = ALL_COLLECTIONS
    else:
        # Intent classifier: один Gemini запит визначає галузь → жорсткий вибір колекцій
        target_collections = await _classify_and_route(search_question, ALL_COLLECTIONS)

    fetch_k = body.max_docs * 2
    match_threshold = settings_cache.get_float("match_threshold_docs", 0.35)

    # 3. Пошук: оригінальний вектор + HyDE вектор паралельно → merge
    try:
        if hypothetical_text:
            hyp_vector, orig_results = await _asyncio.gather(
                _asyncio.to_thread(embeddings.embed_query, hypothetical_text),
                _asyncio.to_thread(search_qdrant, query_vector, fetch_k, target_collections, match_threshold),
            )
            hyp_results = await _asyncio.to_thread(
                search_qdrant, hyp_vector, fetch_k, target_collections, match_threshold
            )
            # Merge: дедуплікація по (law_id, chunk_index), беремо max score
            seen: dict = {}
            for r in orig_results + hyp_results:
                key = (
                    r["out_metadata"].get("law_id", ""),
                    r["out_metadata"].get("chunk_index", 0),
                )
                if key not in seen or r["similarity"] > seen[key]["similarity"]:
                    seen[key] = r
            results = sorted(seen.values(), key=lambda x: x["similarity"], reverse=True)
        else:
            # HyDE не спрацював — fallback до звичайного пошуку
            results = await _asyncio.to_thread(
                search_qdrant, query_vector, fetch_k, target_collections, match_threshold
            )
    except Exception:
        results = await _asyncio.to_thread(
            search_qdrant, query_vector, fetch_k, target_collections, match_threshold
        )

    # Source priority boost — піднімаємо Раду відносно Wiki/інших
    # Значення > 1.0 = Рада іде вище; 1.0 = без буста (можна змінити в адмінці)
    rada_boost = settings_cache.get_float("rada_source_boost", 1.15)
    if abs(rada_boost - 1.0) > 0.001:
        for r in results:
            col = r.get("_collection", "")
            # laws_positions — найвищий пріоритет: відформульовані позиції ВС
            if col == "laws_positions":
                r["similarity"] = min(r["similarity"] * rada_boost * 1.1, 1.0)
            elif col.startswith("rada_") or col == "laws_supreme":
                r["similarity"] = min(r["similarity"] * rada_boost, 1.0)
        results.sort(key=lambda x: x["similarity"], reverse=True)

    # Diversity: кожна пошукана колекція отримує гарантований 1 слот (крім laws_positions — макс 1/3).
    # Решта слотів заповнюється конкурентно по similarity.
    # Це узагальнений підхід — не залежить від конкретних колекцій.
    _max_pos = max(1, body.max_docs // 3)

    # Групуємо результати по колекціях
    _by_col: dict[str, list] = {}
    for r in results:
        col = r.get("_collection", "")
        _by_col.setdefault(col, []).append(r)

    # laws_positions — обмежено; решта — гарантовано 1 слот кожна
    _pos_col = _by_col.pop("laws_positions", [])
    pos_taken = _pos_col[:_max_pos]

    guaranteed: list = []
    overflow: list = []
    for col, docs in _by_col.items():
        guaranteed.append(docs[0])   # 1 кращий з колекції (вже відсортовано)
        overflow.extend(docs[1:])

    remaining = body.max_docs - len(pos_taken) - len(guaranteed)
    filler = sorted(overflow + _pos_col[_max_pos:], key=lambda x: x["similarity"], reverse=True)
    results = pos_taken + guaranteed + filler[:max(0, remaining)]
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

    # Keyword search: завжди паралельно з vector — знаходить документи з поганим embedding
    min_score = settings_cache.get_float("min_relevance_score", 0.35)
    try:
        from qdrant_storage import search_qdrant_text
        _kw_query = hypothetical_text or search_question  # HyDE текст — юридична мова, правильні терміни
        _kw_results = search_qdrant_text(_kw_query, target_collections, limit=3)
        _existing_ids = {
            (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
            for r in results
        }
        _kw_added = 0
        for r in _kw_results:
            _key = (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
            if _key not in _existing_ids:
                results.append(r)
                _existing_ids.add(_key)
                _kw_added += 1
        if _kw_added:
            results.sort(key=lambda x: x["similarity"], reverse=True)
            logger.info("Keyword: додано %d нових результатів", _kw_added)
    except Exception as _kw_err:
        logger.warning("Keyword search error: %s", _kw_err)

    # Hard-stop: якщо нічого релевантного — не викликаємо Gemini, не галюцинуємо
    if not results or results[0]["similarity"] < min_score:
        return {
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
        }

    # 3. Будуємо збагачений контекст для LLM + citations для фронтенду
    # law_chunks — закони Ради; kmu_chunks — постанови КМУ; court_chunks — судова практика
    citations: list[dict] = []
    law_chunks:   list[str] = []
    kmu_chunks:   list[str] = []
    court_chunks: list[str] = []

    # Скасовані документи виключаємо повністю — не в контекст, не в citations
    # (вони дезорієнтують LLM і вводять користувача в оману)
    def _is_expired(r: dict) -> bool:
        s = r["out_metadata"].get("status", "").lower()
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
            "num": num,
            "source_title": title,
            "passage": clean_passage,
            "status": meta.get("status", ""),
            "law_url": law_url,
            "chunk_index": meta.get("chunk_index", 0),
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
        if col in ("laws_positions", "laws_supreme", "laws_ccu"):
            court_chunks.append(chunk_text)
        elif col == "laws_kmu":
            kmu_chunks.append(chunk_text)
        else:
            law_chunks.append(chunk_text)

    # Контекст: 1) закони Ради, 2) постанови КМУ, 3) судова практика
    parts: list[str] = []
    if law_chunks:
        parts.append("\n\n".join(law_chunks))
    if kmu_chunks:
        parts.append(
            "--- Постанови та розпорядження КМУ ---\n\n"
            + "\n\n".join(kmu_chunks)
        )
    if court_chunks:
        parts.append(
            "--- Судова практика та правові позиції ---\n\n"
            + "\n\n".join(court_chunks)
        )
    context = "\n\n".join(parts) if parts else "Контекст відсутній."

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
        max_output_tokens = int(settings_cache.get_float("max_output_tokens", 3000))

        # Build response instructions based on plan features
        rf = set(body.response_features)
        response_instructions = ["Надай точну структуровану відповідь."]
        if "response_detailed" in rf:
            response_instructions.append(
                "Дай розгорнуту відповідь з аналізом: поясни суть, розкрий деталі, "
                "вкажи винятки та важливі нюанси."
            )
        if "response_steps" in rf:
            response_instructions.append(
                "Обов'язково додай розділ «Що робити далі» з конкретними покроковими діями."
            )
        if "response_scenarios" in rf:
            response_instructions.append(
                "Розглянь альтернативні сценарії розвитку ситуації та їхні наслідки."
            )
        if "response_vs_position" in rf:
            response_instructions.append(
                "Посилайся на конкретні правові позиції Верховного суду з джерел, якщо вони присутні в контексті."
            )
        response_instructions.append(
            "Посилайся на джерела у форматі [1], [2] одразу після твердження. "
            "Якщо контекст не містить потрібної інформації — чесно повідом про це."
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

        # Build conversation history block (last 6 turns max to stay within token budget)
        history_block = ""
        if body.history:
            recent = body.history[-12:]  # 12 повідомлень = 6 turns (user+assistant)
            history_lines: list[str] = []
            for turn in recent:
                role = turn.get("role", "")
                content = (turn.get("content") or "").strip()[:1000]  # cap per-turn length
                if role == "user":
                    history_lines.append(f"Користувач: {content}")
                elif role == "assistant":
                    history_lines.append(f"Асистент: {content}")
            if history_lines:
                history_block = "Попередній діалог:\n" + "\n".join(history_lines) + "\n\n"

        prompt = (
            f"{profile_block}"
            f"{personal_block}"
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

        llm_timeout = settings_cache.get_float("llm_timeout_seconds", 90.0)
        try:
            response, clf_response = await _asyncio.wait_for(
                _asyncio.gather(
                    _asyncio.to_thread(
                        main_model.generate_content,
                        prompt,
                        generation_config=GenerationConfig(temperature=temperature, top_p=top_p, max_output_tokens=max_output_tokens),
                    ),
                    _asyncio.to_thread(
                        clf_model.generate_content,
                        clf_prompt,
                        generation_config=GenerationConfig(
                            temperature=0.0,
                            response_mime_type="application/json",
                        ),
                    ),
                ),
                timeout=llm_timeout,
            )
        except _asyncio.TimeoutError:
            raise HTTPException(504, f"AI не відповів за {llm_timeout:.0f}с — спробуйте пізніше")

        answer = response.text

        tokens_used = 0
        try:
            tokens_used = response.usage_metadata.total_token_count or 0
        except Exception:
            pass

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"AI error: {e}")

    # Parse AI classification; fall back to defaults if model returns garbage
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

    # Filter citations — keep only those actually referenced in the answer
    # used_nums = {int(n) for n in re.findall(r"\[(\d+)\]", answer)} # Removed: no longer filtering by explicit AI citations
    used_citations = citations # Changed: return all relevant citations up to max_docs

    # Category — most common category from retrieved Qdrant chunks
    cats = [r["out_metadata"].get("category", "") for r in results if r["out_metadata"].get("category")]
    category = max(set(cats), key=cats.count) if cats else "Загальне"

    elapsed_ms = int((time.time() - start_time) * 1000)

    return {
        "answer": answer,
        "references": used_citations,
        "templates": [],
        "_meta": {
            "processing_time_ms": elapsed_ms,
            "tokens_used": tokens_used,
            "category": category,
            **classification,
        },
    }


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

    model_name = settings_cache.get("ai_model") or "gemini-2.0-flash-001"
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


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
