"""
auth_router.py — Authentication & anti-abuse helpers for Lawyer AI.

Endpoints:
  POST /auth/login-event       — record IP, geo, UA, fingerprint on login
  POST /auth/fingerprint-check — detect multi-account abuse by fingerprint

Dependencies (used inside /ask):
  get_optional_user            — extract user from Bearer token (or None)
  check_and_increment_limit    — enforce daily_limit; NULL = unlimited
"""

import os
import datetime
import httpx
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Header
from pydantic import BaseModel

# ── Supabase config ───────────────────────────────────────────────────────────
SUPABASE_URL        = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY   = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_ANON_KEY)

router = APIRouter(prefix="/auth", tags=["auth"])


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _sb_headers(service: bool = False) -> dict:
    key = SUPABASE_SERVICE_KEY if service else SUPABASE_ANON_KEY
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _validate_token(token: str) -> Optional[dict]:
    """Call Supabase /auth/v1/user to verify the JWT and return the user."""
    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass
    return None


def _get_profile(user_id: str) -> Optional[dict]:
    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{user_id}", "select": "*"},
                headers=_sb_headers(service=True),
            )
            if r.status_code == 200 and r.json():
                return r.json()[0]
    except Exception:
        pass
    return None


def _patch_profile(user_id: str, payload: dict) -> None:
    """PATCH a profile row by id (service role — bypasses RLS)."""
    try:
        with httpx.Client(timeout=5.0) as c:
            c.patch(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{user_id}"},
                json=payload,
                headers=_sb_headers(service=True),
            )
    except Exception:
        pass


def _upsert_profile(payload: dict) -> None:
    """INSERT … ON CONFLICT (id) DO UPDATE (service role)."""
    try:
        with httpx.Client(timeout=5.0) as c:
            c.post(
                f"{SUPABASE_URL}/rest/v1/profiles",
                json=payload,
                params={"on_conflict": "id"},
                headers={**_sb_headers(service=True), "Prefer": "resolution=merge-duplicates"},
            )
    except Exception:
        pass


def _extract_ip(request: Request) -> str:
    """Get real client IP, respecting reverse-proxy headers."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else ""


def _get_geo(ip: str) -> dict:
    """
    Look up city/country from IP using ip-api.com (free, no key needed).
    Returns {} on any error or for private/local IPs.
    """
    if not ip or ip in ("127.0.0.1", "::1", "localhost", ""):
        return {}
    # Skip RFC-1918 private ranges (Docker, NAT, etc.)
    private_prefixes = ("10.", "172.16.", "172.17.", "192.168.", "::ffff:127.")
    if any(ip.startswith(p) for p in private_prefixes):
        return {}
    try:
        with httpx.Client(timeout=3.0) as c:
            r = c.get(
                f"http://ip-api.com/json/{ip}",
                params={"fields": "status,city,country,countryCode", "lang": "uk"},
            )
            data = r.json()
            if data.get("status") == "success":
                return {
                    "city":         data.get("city", ""),
                    "country":      data.get("country", ""),
                    "country_code": data.get("countryCode", ""),
                }
    except Exception:
        pass
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI dependencies
# ─────────────────────────────────────────────────────────────────────────────

async def get_current_user(authorization: str = Header(default="")) -> dict:
    """Require a valid Supabase Bearer token. Raises 401 otherwise."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, detail="Missing Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    user  = _validate_token(token)
    if not user:
        raise HTTPException(401, detail="Invalid or expired token")
    return user


async def get_optional_user(authorization: str = Header(default="")) -> Optional[dict]:
    """Same as get_current_user but returns None instead of raising."""
    if not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    return _validate_token(token)


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class LoginEventPayload(BaseModel):
    fingerprint: Optional[str] = None   # djb2 hash from client JS


class FingerprintCheckPayload(BaseModel):
    fingerprint: str


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/login-event")
async def login_event(
    payload: LoginEventPayload,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """
    Called after login / onboarding. Records:
      - IP address
      - City + country (via ip-api.com)
      - User-Agent string
      - Browser fingerprint hash
    Used for geo-analytics and multi-account abuse detection.
    """
    user_id = user["id"]
    ip  = _extract_ip(request)
    ua  = request.headers.get("user-agent", "")
    geo = _get_geo(ip)

    patch: dict = {
        "last_ip":           ip   or None,
        "user_agent":        ua   or None,
        "last_city":         geo.get("city")         or None,
        "last_country":      geo.get("country")      or None,
        "last_country_code": geo.get("country_code") or None,
        "updated_at":        datetime.datetime.utcnow().isoformat(),
    }
    if payload.fingerprint:
        patch["browser_fingerprint"] = payload.fingerprint

    _patch_profile(user_id, patch)

    return {
        "ok":  True,
        "ip":  ip,
        "geo": geo,
    }


@router.post("/fingerprint-check")
async def fingerprint_check(payload: FingerprintCheckPayload):
    """
    Anti-multi-account check.
    - Blocks new account if this device already exhausted its free limit.
    - Returns trial_used=True if this device has already consumed a free trial
      (so the new account is immediately marked trial_used on registration).
    """
    if not payload.fingerprint:
        return {"blocked": False, "trial_used": False}

    try:
        with httpx.Client(timeout=5.0) as c:
            r = c.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={
                    "browser_fingerprint": f"eq.{payload.fingerprint}",
                    "select": "id,requests_this_month,monthly_limit,is_premium,limit_reset_at,trial_used",
                },
                headers=_sb_headers(service=True),
            )
            if r.status_code == 200 and r.json():
                now = datetime.datetime.now(tz=datetime.timezone.utc)
                device_trial_used = False

                for p in r.json():
                    # Track if ANY account on this device has consumed a trial
                    if p.get("trial_used"):
                        device_trial_used = True

                    if p.get("is_premium"):
                        continue
                    limit = p.get("monthly_limit")
                    if limit is None:
                        continue
                    count = p.get("requests_this_month", 0) or 0
                    # If 30-day window has expired, counter resets
                    reset_str = p.get("limit_reset_at", "")
                    if reset_str:
                        try:
                            reset_at = datetime.datetime.fromisoformat(
                                reset_str.replace("Z", "+00:00")
                            )
                            if now >= reset_at:
                                count = 0
                        except Exception:
                            pass
                    if count >= limit:
                        return {
                            "blocked": True,
                            "trial_used": device_trial_used,
                            "message": "Ви вже використовували безкоштовні ліміти на цьому пристрої",
                        }

                return {"blocked": False, "trial_used": device_trial_used}
    except Exception:
        pass

    return {"blocked": False, "trial_used": False}


# ─────────────────────────────────────────────────────────────────────────────
# Limit helper — used by /ask
# ─────────────────────────────────────────────────────────────────────────────

def check_and_increment_limit(user_id: str) -> None:
    """
    Enforce monthly_limit for the /ask endpoint using a 30-day rolling window.
      - monthly_limit IS NULL  → unlimited, always allow
      - monthly_limit = N      → allow up to N requests per 30-day window
    Raises HTTP 429 when limit is reached.
    NOTE: counter increment is handled by the Next.js messages API route.
    """
    profile = _get_profile(user_id)
    if not profile:
        return

    now = datetime.datetime.now(tz=datetime.timezone.utc)

    # Premium or unlimited — always allow
    if profile.get("is_premium"):
        return

    monthly_limit = profile.get("monthly_limit")  # None = unlimited
    if monthly_limit is None:
        return

    count        = profile.get("requests_this_month", 0) or 0
    new_reset_at = None

    # Check if the 30-day window has expired
    reset_str = profile.get("limit_reset_at", "")
    if reset_str:
        try:
            reset_at = datetime.datetime.fromisoformat(reset_str.replace("Z", "+00:00"))
            if not reset_at.tzinfo:
                reset_at = reset_at.replace(tzinfo=datetime.timezone.utc)
            if now >= reset_at:
                # Window expired — reset counter, open new 30-day window
                count        = 0
                new_reset_at = now + datetime.timedelta(days=30)
        except Exception:
            pass
    else:
        # No window set yet — start first 30-day window now
        new_reset_at = now + datetime.timedelta(days=30)

    if count >= monthly_limit:
        raise HTTPException(
            status_code=429,
            detail={
                "error":   "monthly_limit_exceeded",
                "message": f"Ви вичерпали ліміт запитів ({monthly_limit}). "
                           f"Оформіть підписку для необмеженого доступу.",
                "limit":   monthly_limit,
                "used":    count,
            },
        )

    # Counter is incremented by the Next.js messages API route (more reliable).
    # Python only enforces the limit gate here.
