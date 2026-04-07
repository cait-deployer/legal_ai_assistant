"""
settings_cache.py — Центральний модуль налаштувань.

Завантажує всі налаштування з Supabase app_settings при старті,
кешує в пам'яті. Також містить хелпери для Vertex AI credentials.

Використання:
    from settings_cache import get, refresh, get_credentials, get_vertex_project

    creds   = get_credentials()          # google.oauth2.Credentials або None
    project = get_vertex_project()       # "urai-492512"
    model   = get("ai_model")
    await refresh()
"""

import os
import json
import asyncio
import threading
import httpx
from typing import Any
from dotenv import load_dotenv

# Завантажуємо .env до читання змінних (settings_cache імпортується раніше load_dotenv у server.py)
load_dotenv()

# ── Supabase connection (єдине місце де беремо з env) ────────────────────────
_SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
# Service role key preferred (bypasses RLS), falls back to anon key
_SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)

# ── Кеш ──────────────────────────────────────────────────────────────────────
_cache: dict[str, Any] = {}
_lock = threading.Lock()
_loaded = False

# ── Дефолти ───────────────────────────────────────────────────────────────────
_DEFAULTS: dict[str, Any] = {
    "service_account_json": "",          # JSON-вміст service account файлу
    "vertex_location":      "us-central1",
    "ai_model":             "gemini-2.0-flash-lite",
    "embedding_model":      "text-embedding-004",
    "system_prompt":        "Ти — досвідчений український адвокат. Надай точну відповідь базуючись ТІЛЬКИ на контексті.",
    "temperature":          "0.1",
    "top_p":                "0.8",
    "schedule_enabled":     False,
}


def _parse_row(row: dict) -> Any:
    if row.get("value_text") is not None:
        return row["value_text"]
    if row.get("value_int") is not None:
        return row["value_int"]
    if row.get("value_bool") is not None:
        return row["value_bool"]
    return None


def _load_sync() -> dict[str, Any]:
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(
                f"{_SUPABASE_URL}/rest/v1/app_settings",
                headers={
                    "apikey": _SUPABASE_KEY,
                    "Authorization": f"Bearer {_SUPABASE_KEY}",
                },
            )
            if r.status_code == 200:
                result = {}
                for row in r.json():
                    val = _parse_row(row)
                    if val is not None:
                        result[row["key"]] = val
                return result
    except Exception as e:
        print(f"⚠️ [settings_cache] Supabase unavailable: {e}")
    return {}


def load() -> None:
    global _cache, _loaded
    if not _SUPABASE_URL or not _SUPABASE_KEY:
        print("⚠️  [settings_cache] SUPABASE URL or KEY not set — using defaults only!")
    data = _load_sync()
    with _lock:
        _cache = {**_DEFAULTS, **data}
        _loaded = True
    sa_loaded = bool(data.get("service_account_json"))
    if not data:
        print("❌ [settings_cache] 0 keys loaded — check SUPABASE_SERVICE_ROLE_KEY in .env!")
    else:
        print(f"✅ [settings_cache] {len(data)} keys loaded. Service account: {'✓' if sa_loaded else '✗'}")


async def refresh() -> None:
    global _cache
    data = await asyncio.to_thread(_load_sync)
    with _lock:
        _cache = {**_DEFAULTS, **data}
    print(f"🔄 [settings_cache] refreshed ({len(data)} keys)")


def get(key: str, default: Any = None) -> Any:
    global _loaded
    if not _loaded:
        load()
    with _lock:
        val = _cache.get(key)
    if val is None or val == "":
        return default if default is not None else _DEFAULTS.get(key)
    return val


def get_float(key: str, default: float = 0.0) -> float:
    try:
        return float(get(key, default))
    except (TypeError, ValueError):
        return default


def get_bool(key: str, default: bool = False) -> bool:
    val = get(key, default)
    if isinstance(val, bool):
        return val
    return str(val).lower() in ("true", "1", "yes")


def get_all() -> dict[str, Any]:
    if not _loaded:
        load()
    with _lock:
        return dict(_cache)


# ── Vertex AI helpers ─────────────────────────────────────────────────────────

def get_sa_info() -> dict | None:
    """Повертає розпарсений service account JSON або None."""
    raw = get("service_account_json", "")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception as e:
        print(f"⚠️ [settings_cache] Invalid service_account_json: {e}")
        return None


def get_vertex_project() -> str:
    """project_id з service account JSON."""
    sa = get_sa_info()
    if sa:
        return sa.get("project_id", "")
    return os.environ.get("VERTEX_PROJECT", "")


def get_vertex_location() -> str:
    return get("vertex_location", "us-central1")


def get_credentials():
    """
    Повертає google.oauth2.service_account.Credentials або None.
    Використовується для ініціалізації Vertex AI та google.genai.
    """
    sa = get_sa_info()
    if not sa:
        return None
    try:
        from google.oauth2 import service_account
        return service_account.Credentials.from_service_account_info(
            sa,
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    except Exception as e:
        print(f"⚠️ [settings_cache] credentials error: {e}")
        return None
