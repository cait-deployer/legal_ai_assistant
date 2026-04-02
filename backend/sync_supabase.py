import os
import httpx
from dotenv import load_dotenv
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2 import service_account
from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
import tempfile

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE")
FOLDER_ID = os.environ.get("DRIVE_FOLDER_ID")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL")

embeddings = GoogleGenerativeAIEmbeddings(
    model=EMBEDDING_MODEL,
    google_api_key=os.environ.get("GOOGLE_API_KEY")
)

def file_exists_in_supabase(filename):
    """Проверяет, есть ли уже в базе чанки из этого файла"""
    url = f"{SUPABASE_URL}/rest/v1/documents?metadata->>source=eq.{filename}&select=id"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    r = httpx.get(url, headers=headers)
    if r.status_code == 200:
        return len(r.json()) > 0
    return False

def upload_to_supabase(text, metadata, embedding):
    url = f"{SUPABASE_URL}/rest/v1/documents"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    data = {"content": text, "metadata": metadata, "embedding": embedding}
    r = httpx.post(url, headers=headers, json=data)
    r.raise_for_status()

def sync_drive_to_supabase():
    # 1. Авторизация
    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=['https://www.googleapis.com/auth/drive.readonly']
    )
    service = build('drive', 'v3', credentials=creds)

    # 2. Поиск файлов (теперь добавили поддержку .txt для твоего парсера Рады)
    q = f"'{FOLDER_ID}' in parents and (mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='text/plain')"
    results = service.files().list(q=q, fields="files(id, name, mimeType)").execute()
    files = results.get('files', [])

    if not files:
        print("📭 Новых файлов на Диске не найдено.")
        return

    for file in files:
        filename = file['name']
        
        # 3. ПРОВЕРКА НА ДУБЛИКАТЫ
        if file_exists_in_supabase(filename):
            print(f"⏩ Пропуск: {filename} уже есть в базе.")
            continue

        print(f"📥 Новая загрузка: {filename}...")
        request = service.files().get_media(fileId=file['id'])

        # Определяем тип файла
        if filename.endswith('.pdf'): suffix = '.pdf'
        elif filename.endswith('.docx'): suffix = '.docx'
        else: suffix = '.txt'

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            downloader = MediaIoBaseDownload(tmp, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            tmp_path = tmp.name

        # 4. Выбор лоадера (добавили TextLoader для законов с Рады)
        if suffix == '.pdf': loader = PyPDFLoader(tmp_path)
        elif suffix == '.docx': loader = Docx2txtLoader(tmp_path)
        else: loader = TextLoader(tmp_path, encoding='utf-8')

        chunks = RecursiveCharacterTextSplitter(
            chunk_size=1200, # Немного увеличили для лучшего контекста юриста
            chunk_overlap=200
        ).split_documents(loader.load())

        # 5. Векторизация и отправка
        for chunk in chunks:
            for attempt in range(3):
                try:
                    vector = embeddings.embed_query(chunk.page_content)
                    upload_to_supabase(
                        text=chunk.page_content,
                        metadata={"source": filename},
                        embedding=vector
                    )
                    break
                except Exception as e:
                    print(f"⚠️ Ошибка при загрузке чанка: {e}. Пробую еще раз...")
                    import time; time.sleep(5)

        os.remove(tmp_path)
        print(f"✅ {filename} — успешно добавлен.")

    print("\n🎉 Синхронизация завершена. База актуализирована!")

if __name__ == "__main__":
    sync_drive_to_supabase()