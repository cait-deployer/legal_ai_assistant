# backend/services/sync_service.py
# Kept for backwards compatibility. Main sync logic is now in server.py.
import datetime
import httpx
import os
import sys

# Allow importing from parent directory when run directly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rada_to_supabase import run_rada_sync


def trigger_sync():
    url = f"{os.environ.get('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/sync_logs"
    headers = {
        "apikey": os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
        "Authorization": f"Bearer {os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

    start_payload = {
        "status": "running",
        "started_at": datetime.datetime.now().isoformat()
    }
    r = httpx.post(url, headers=headers, json=start_payload)
    log_entry = r.json()[0] if r.status_code == 201 else None
    log_id = log_entry.get('id') if log_entry else None

    try:
        stats = run_rada_sync()
        if log_id:
            httpx.patch(f"{url}?id=eq.{log_id}", headers=headers, json={
                "status": "success",
                "finished_at": datetime.datetime.now().isoformat(),
                "laws_processed": stats.get('processed', 0) if stats else 0,
            })
        return {"status": "success", "stats": stats}
    except Exception as e:
        if log_id:
            httpx.patch(f"{url}?id=eq.{log_id}", headers=headers, json={
                "status": "error",
                "error_message": str(e),
                "finished_at": datetime.datetime.now().isoformat(),
            })
        return {"status": "error", "message": str(e)}
