
    # model="models/gemini-embedding-001",
import os
import json
import httpx
from dotenv import load_dotenv
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2 import service_account
from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
import tempfile

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE")
FOLDER_ID = os.environ.get("DRIVE_FOLDER_ID")

# ✅ ФИКС: правильное название модели для langchain-google-genai
embeddings = GoogleGenerativeAIEmbeddings(
    model="models/gemini-embedding-001",
    google_api_key=os.environ.get("GOOGLE_API_KEY")
)

def upload_to_supabase(text, metadata, embedding):
    url = f"{SUPABASE_URL}/rest/v1/documents"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
    }
    data = {
        "content": text,
        "metadata": metadata,
        "embedding": embedding
    }
    r = httpx.post(url, headers=headers, json=data)
    r.raise_for_status()

def sync_drive_to_supabase():
    # 1. Авторизация в Google Drive
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=['https://www.googleapis.com/auth/drive.readonly']
    )
    service = build('drive', 'v3', credentials=creds)

    # 2. Поиск PDF и DOCX файлов в папке
    results = service.files().list(
        q=f"'{FOLDER_ID}' in parents and (mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')",
        fields="files(id, name)"
    ).execute()
    files = results.get('files', [])

    if not files:
        print("📭 Файлов на Диске не найдено.")
        return

    # 3. Очистка старой базы
    httpx.delete(
        f"{SUPABASE_URL}/rest/v1/documents?id=not.eq.0",
        headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    )

    # 4. Обработка каждого файла
    for file in files:
        print(f"📥 Обработка: {file['name']}...")
        request = service.files().get_media(fileId=file['id'])

        # Определяем расширение для временного файла
        suffix = '.pdf' if file['name'].endswith('.pdf') else '.docx'

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            downloader = MediaIoBaseDownload(tmp, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            tmp_path = tmp.name

        # 5. Загрузка и нарезка на чанки
        loader = PyPDFLoader(tmp_path) if suffix == '.pdf' else Docx2txtLoader(tmp_path)
        chunks = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=150
        ).split_documents(loader.load())

        # 6. Векторизация и отправка в Supabase
        for chunk in chunks:
            # Retry при 503 от Google
            for attempt in range(5):
                try:
                    vector = embeddings.embed_query(chunk.page_content)
                    break
                except Exception as e:
                    if "503" in str(e) and attempt < 4:
                        wait = 10 * (attempt + 1)
                        print(f"⏳ Google 503, жду {wait}с (попытка {attempt+1}/5)...")
                        import time; time.sleep(wait)
                    else:
                        raise
            upload_to_supabase(
                text=chunk.page_content,
                metadata={"source": file['name']},
                embedding=vector
            )

        os.remove(tmp_path)
        print(f"✅ {file['name']} — загружен в Supabase.")

    print("\n🎉 Готово! Все документы синхронизированы.")

if __name__ == "__main__":
    sync_drive_to_supabase()    