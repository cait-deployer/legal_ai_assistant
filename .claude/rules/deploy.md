# Rules for deploy / server operations

## Server
- Host: `n-ai01.nexchance.de`
- User: `root`
- App dir: `/home/devops/app`
- Backend: FastAPI on port 8001, managed by `systemctl backend.service`
- Frontend: Next.js, managed by `systemctl frontend.service`

## Deploy commands (copy-paste ready)
```bash
ssh root@n-ai01.nexchance.de
cd /home/devops/app && git pull

# Python only:
systemctl restart backend.service

# JS/TS only:
npm run build && systemctl restart frontend.service

# Both:
npm run build && systemctl restart frontend.service && systemctl restart backend.service

# New Python deps:
pip install -r requirements.txt && systemctl restart backend.service
```

## Pre-deploy checklist
Before deploying, always verify:
1. New settings keys added to BOTH frontend schema AND Supabase SQL
2. New Python deps added to `requirements.txt`
3. No `.env` or credentials files in staged changes
4. Backend starts without errors after `systemctl restart`
5. `/api/health` returns 200 after restart

## Reindex scripts (run on server directly)
```bash
cd /home/devops/app/backend
python reindex_kmu_full.py     # full KMU reindex (~20-24h)
python reindex_rada_full.py    # full Rada reindex (~40-50h)
python repair_missing.py --both  # fix gaps after reindex
```

## Secrets
- `.env` lives on server only — NEVER commit it
- Service account JSON: `/home/devops/app/backend/service-account.json` — NEVER commit
- Supabase credentials: in `.env` on server

## Monitoring
- Backend logs: `journalctl -u backend.service -f`
- Frontend logs: `journalctl -u frontend.service -f`
- Qdrant health: `curl http://localhost:6333/healthz`
- Qdrant collections: `curl http://localhost:6333/collections`
- RAM: `free -h` (10Gi total, keep >2Gi free for Qdrant MMAP)
- Disk: `df -h /` (Qdrant data at ~7GB, grows with each reindex)
