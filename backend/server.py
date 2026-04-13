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
from concurrent.futures import ThreadPoolExecutor as _TPE
from datetime import datetime, timezone, timedelta
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
_SOURCES = ("rada", "supreme", "wiki", "templates", "ccu")
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

        # 2. Метадані існуючих — по всіх колекціях паралельно
        log("🔍 Завантаження метаданих Qdrant...")
        existing_meta = get_all_existing_laws_meta()
        log(f"📊 В базі вже: {len(existing_meta)} законів")

        total = len(all_laws)

        # ── Функція обробки одного закону (виконується в потоці) ──────────
        def _process_law(i: int) -> int:
            """Повертає 1 якщо закон оброблено, 0 якщо пропущено."""
            law       = all_laws[i]
            law_id    = law["id"]
            law_title = law["title"]
            category  = law["category"]
            law_url   = f"{BASE}/laws/show/{law_id}"
            coll      = get_collection_for_category(category)

            # Дедуплікація / оновлення
            if law_id in existing_meta:
                meta           = existing_meta[law_id]
                stored_date    = meta.get("effective_date", "")
                list_date      = law.get("list_date", "")
                stored_coll    = meta.get("collection_name", coll)
                if stored_date and list_date:
                    if stored_date == list_date:
                        log(f"  ⏭ [{i + 1}] {law_id} — вже є (дата {stored_date})")
                        return 0
                    log(f"🔄 Нова редакція {law_id}: {stored_date} → {list_date}")
                    delete_law_chunks(law_id, stored_coll)
                else:
                    try:
                        last_str = meta.get("scraped_at", "").replace("Z", "+00:00")
                        last = datetime.fromisoformat(last_str)
                        now  = datetime.now(timezone.utc) if last.tzinfo else datetime.now()
                        if (now - last).days < 7:
                            log(f"  ⏭ [{i + 1}] {law_id} — скраповано {(now - last).days} дн. тому")
                            return 0
                        log(f"🔄 Оновлення: {law_id} (вік: {(now - last).days} дн.)")
                        delete_law_chunks(law_id, stored_coll)
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


def _do_wiki(session_id: str) -> None:
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

        articles = get_all_wiki_articles()
        log(f"🔎 Знайдено статей: {len(articles)}")

        existing_ids = get_existing_law_ids()
        log(f"📋 Вже в базі: {len(existing_ids)} документів")

        total = len(articles)

        for i, art in enumerate(articles):
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


def _do_ccu(session_id: str) -> None:
    src = "ccu"
    log = lambda m, lv="info": _log(src, m, lv)
    log("=" * 50)
    log(f"⚖️ CCU SYNC (сесія {session_id[:8]}...)")
    log("=" * 50)
    _sb_insert_log(src, session_id)
    processed = 0
    try:
        from ccu_scanner import run_ccu_sync

        def pause_check():
            with _lock:
                return _sync[src]["pause_requested"]

        def log_callback(msg: str):
            level = "error" if "❌" in msg else "success" if "✅" in msg else "warning" if "⚠️" in msg or "⏸️" in msg else "info"
            log(msg, level)
            with _lock:
                _sync[src]["laws_processed"] = processed

        ok, total = run_ccu_sync(
            session_id=session_id,
            log_callback=log_callback,
            pause_check=pause_check,
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
                error_message=f"Призупинено",
            )
        else:
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
    return {
        "running":        running,
        "pause_requested": pause_req,
        "live_logs":      logs,
        "history":        _sb_get_logs("ccu", 20),
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
        "created_at,last_ip,user_agent,marketing_consent,limit_reset_at"
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
        else:
            target_cols = ALL_COLLECTIONS

        all_points: list = []
        for col in target_cols:
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
_rada_totals_cache: dict[str, int] = {}   # code -> total_docs_on_rada
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
    from rada_scanner import ALL_THEMES, get_total_pages

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
    global _rada_totals_cache, _rada_cache_time
    now = _time.time()
    if refresh or not _rada_totals_cache or (now - _rada_cache_time) > _RADA_CACHE_TTL:
        # Паралельний запит до Ради (max 5 одночасно)
        sem = _asyncio.Semaphore(5)
        async def _fetch(code: str) -> tuple[str, int]:
            async with sem:
                pages = await _asyncio.to_thread(get_total_pages, code)
                return code, pages * 50
        results = await _asyncio.gather(*[_fetch(code) for code, _ in ALL_THEMES])
        _rada_totals_cache = dict(results)
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
            "our_total":       our_total,
            "our_restricted":  our_restricted,
            "our_public":      our_public,
            "coverage_pct":    coverage_pct,
            "last_scraped_at": our["last_scraped_at"],
            "health":          health,
        })

    return {
        "sections":      sections,
        "last_sync_at":  last_sync_at,
        "cache_age_sec": int(now - _rada_cache_time) if _rada_cache_time else None,
    }


# ── /ask — основний чат-ендпоінт ──────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str
    max_docs: int = 8                          # max chunks from Qdrant (from user's plan)
    filter_domains: list[str] | None = None    # kept for backward compat (unused)
    filter_sources: list[str] | None = None    # e.g. ["rada", "wiki", "supreme", "ccu"]
    response_features: list[str] = []          # enabled response quality features from plan
    user_profile: dict | None = None           # {role, sub_role, segment} from onboarding


_CLF_FALLBACK = {"sentiment": "neutral", "complexity_score": 1, "user_intent": "консультація"}


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

    # 2. Визначаємо колекції — завжди ALL, фільтр тільки по плану (filter_sources)
    from qdrant_storage import search_qdrant, RADA_COLLECTIONS, ALL_COLLECTIONS

    if body.filter_sources:
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
        if not target_collections:
            target_collections = ALL_COLLECTIONS
    else:
        target_collections = ALL_COLLECTIONS

    fetch_k = body.max_docs * 2
    match_threshold = settings_cache.get_float("match_threshold_docs", 0.4)
    results = await _asyncio.to_thread(
        search_qdrant, query_vector, fetch_k, target_collections, match_threshold
    )
    results = results[:body.max_docs]

    # Hard-stop: якщо нічого релевантного — не викликаємо Gemini, не галюцинуємо
    min_score = settings_cache.get_float("min_relevance_score", 0.35)
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

        # Збагачений заголовок — LLM бачить всі деталі для точного цитування
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

        context_parts.append(chunk_text)

    context = "\n\n".join(context_parts) if context_parts else "Контекст відсутній."

    # 4. Call Gemini — main answer + classification run concurrently (zero added latency)
    try:
        import json as _json
        import vertexai
        from vertexai.generative_models import GenerativeModel, GenerationConfig

        creds    = settings_cache.get_credentials()
        project  = settings_cache.get_vertex_project()
        location = settings_cache.get_vertex_location()
        vertexai.init(project=project, location=location, credentials=creds)

        model_name    = settings_cache.get("ai_model")
        system_prompt = settings_cache.get(
            "system_prompt",
            "Ти — досвідчений український адвокат. Надавай точні відповіді виключно на основі наданого контексту.",
        )
        temperature = settings_cache.get_float("temperature", 0.1)
        top_p       = settings_cache.get_float("top_p", 0.8)

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

        prompt = (
            f"{profile_block}"
            f"Контекст з українського законодавства (кожен фрагмент пронумерований):\n\n{context}\n\n"
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

        response, clf_response = await _asyncio.gather(
            _asyncio.to_thread(
                main_model.generate_content,
                prompt,
                generation_config=GenerationConfig(temperature=temperature, top_p=top_p),
            ),
            _asyncio.to_thread(
                clf_model.generate_content,
                clf_prompt,
                generation_config=GenerationConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                ),
            ),
        )
        answer = response.text

        tokens_used = 0
        try:
            tokens_used = response.usage_metadata.total_token_count or 0
        except Exception:
            pass

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
    used_nums = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
    used_citations = [c for c in citations if c["num"] in used_nums] or citations[:3]

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


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
