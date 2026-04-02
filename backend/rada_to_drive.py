import os
import io
import time
import traceback
from dotenv import load_dotenv
from googleapiclient.discovery import build
from google.oauth2 import service_account
from googleapiclient.http import MediaIoBaseUpload

from rada_scanner import (
    get_all_legal_ids,
    get_new_laws,
    get_law_text,
    load_index,
    mark_as_scraped,
)

# 1. Налаштування
load_dotenv()

SERVICE_ACCOUNT_FILE = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE")
FOLDER_ID = os.getenv("DRIVE_FOLDER_ID")
# ВАЖЛИВО: Ваш email для передачі прав власності
OWNER_EMAIL = "cait.solutions.dev@gmail.com" 

DELAY_BETWEEN_REQUESTS = 2   
DELAY_ON_ERROR        = 10   

# ─── Google Drive ──────────────────────────────────────────────────────────────

def get_drive_service():
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/drive"]
    )
    # Цей рядок каже Google, що бот діє ВІД ВАШОГО ІМЕНІ
    # Важливо: використовуйте ваш email
    delegate_creds = creds.with_subject(OWNER_EMAIL) 
    
    return build("drive", "v3", credentials=delegate_creds)

def upload_to_drive(service, filename: str, text: str) -> bool:
    clean_name = filename.replace("/", "_").replace('"', "").replace("\\", "_").strip()
    file_name = f"{clean_name}.txt"

    file_metadata = {
        "name": file_name, 
        "parents": [FOLDER_ID]
    }
    
    fh = io.BytesIO(text.encode("utf-8"))
    media = MediaIoBaseUpload(fh, mimetype="text/plain", resumable=True)

    try:
        # Тепер файл створюється ВЖЕ на вашій квоті
        file = service.files().create(
            body=file_metadata, 
            media_body=media, 
            fields='id'
        ).execute()
        
        print(f"   ☁️  Успішно завантажено від імені власника → ID: {file.get('id')}")
        return True
    except Exception as e:
        print(f"   ❌ Помилка Drive: {e}")
        return False
# ─── Основна логіка (залишається без змін, щоб нічого не зламати) ──────────────

def run(only_category: str = None, dry_run: bool = False):
    print("=" * 60)
    print("🚀 Запуск Rada → Google Drive (Ownership Transfer Mode)")
    print("=" * 60)

    all_laws = get_all_legal_ids()
    if only_category:
        all_laws = [l for l in all_laws if l["category"] == only_category]
    
    index = load_index()
    new_laws = get_new_laws(all_laws, index)

    if not new_laws:
        print("✅ Все вже завантажено!")
        return

    if dry_run:
        print(f"[DRY RUN] Було б завантажено {len(new_laws)} файлів")
        return

    service = get_drive_service()
    success_count = 0
    fail_count = 0

    for i, law in enumerate(new_laws, 1):
        law_id, law_title, category = law["id"], law["title"], law["category"]
        print(f"\n[{i}/{len(new_laws)}] {law_title}")

        text = get_law_text(law_id)
        if not text:
            fail_count += 1
            time.sleep(DELAY_ON_ERROR)
            continue

        file_label = f"[{category}] {law_title}"
        if upload_to_drive(service, file_label, text):
            mark_as_scraped(index, law_id, law_title, category)
            success_count += 1
        else:
            fail_count += 1
            time.sleep(DELAY_ON_ERROR)

        time.sleep(DELAY_BETWEEN_REQUESTS)

    print(f"\n✅ Завантажено: {success_count} | ❌ Помилок: {fail_count}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", type=str, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(only_category=args.category, dry_run=args.dry_run)