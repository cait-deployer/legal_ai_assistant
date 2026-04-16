import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import urllib.request
import urllib.error
import urllib.parse
import json

SUPABASE_URL = "https://n-ai01.nexchance.de/api"
SERVICE_ROLE_KEY = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NzUzNzk3NzEsImV4cCI6MjA5MDczOTc3MX0.F4dFEU30MG5OkAF6BM1S_WAHmSE4IX_yVoM8x6ROWEA"
ANON_KEY = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc1Mzc5NzcxLCJleHAiOjIwOTA3Mzk3NzF9.moRU1HX1cTSK-ohuFYznphAaPCEtrvOsgcfh5lv83f4"
TEST_USER_EMAIL = "idkcontacts@gmail.com"
TEMP_PASSWORD = "TempPass2025!!"

def http_json(url, method='GET', payload=None, headers=None):
    data = json.dumps(payload).encode('utf-8') if payload is not None else None
    h = dict(headers or {})
    if data:
        h['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8'))
    except Exception as e:
        return 0, {"error": str(e)}

# Sign in
status, data = http_json(
    f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
    method='POST',
    payload={"email": TEST_USER_EMAIL, "password": TEMP_PASSWORD},
    headers={'apikey': ANON_KEY}
)
if status not in (200, 201):
    print(f"Sign in failed ({status}): {data}")
    exit(1)

access_token = data['access_token']
refresh_token = data.get('refresh_token', '')
user = data.get('user', {})
expires_at = data.get('expires_at', 9999999999)

# Build session cookie
session = {
    "access_token": access_token,
    "token_type": "bearer",
    "expires_in": 3600,
    "expires_at": expires_at,
    "refresh_token": refresh_token,
    "user": user
}
session_str = json.dumps(session, separators=(',', ':'))
COOKIE_NAME = "sb-n-ai01-auth-token"
CHUNK_SIZE = 3180
chunks = [session_str[i:i+CHUNK_SIZE] for i in range(0, len(session_str), CHUNK_SIZE)]
if len(chunks) == 1:
    cookie_parts = [f"{COOKIE_NAME}={urllib.parse.quote(chunks[0])}"]
else:
    cookie_parts = [f"{COOKIE_NAME}.{i}={urllib.parse.quote(chunk)}" for i, chunk in enumerate(chunks)]
cookie_str = "; ".join(cookie_parts)

# Call /api/ask
ask_payload = {
    'question': 'Які документи потрібні для введення приватного будинку в експлуатацію?',
    'history': [],
    'max_docs': 8
}
status, resp = http_json(
    'https://n-ai01.nexchance.de/api/ask',
    method='POST',
    payload=ask_payload,
    headers={'Cookie': cookie_str}
)
print(f"HTTP {status}")
print(json.dumps(resp, ensure_ascii=False, indent=2))
