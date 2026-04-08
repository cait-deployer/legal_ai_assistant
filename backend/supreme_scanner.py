import os
import httpx
import tempfile
from bs4 import BeautifulSoup
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from rada_to_supabase import embeddings, upload_chunk_to_supabase, get_existing_law_ids
# upload_chunk_to_supabase та get_existing_law_ids тепер проксі до Qdrant
from datetime import datetime
import time

# URL розділу з оглядами практики Верховного Суду
SUPREME_URL = "https://supreme.court.gov.ua/supreme/pro_sud/oglady/"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def get_supreme_reviews():
    # Точна лінка з твого скріншота
    url = "https://supreme.court.gov.ua/supreme/pokazniki-diyalnosti/analiz/"
    
    # Максимально імітуємо реальний браузер
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://supreme.court.gov.ua/",
        "Connection": "keep-alive",
    }

    try:
        # Використовуємо звичайний requests для тесту, іноді він стабільніший з куками
        import requests
        r = requests.get(url, headers=headers, timeout=25)
        r.raise_for_status()
        
        soup = BeautifulSoup(r.text, "html.parser")
        reviews = []
        
        # Шукаємо всі посилання. Якщо клас "documents_container" не спрацює, 
        # ми знайдемо їх за ключовим словом у href
        all_links = soup.find_all("a", href=True)
        print(f"DEBUG: Всього знайдено посилань на сторінці: {len(all_links)}")

        for a in all_links:
            href = a['href']
            # Перевіряємо, чи посилання веде на PDF у сховищі порталу
            if "/storage/portal/supreme/" in href.lower() and href.endswith(".pdf"):
                title_span = a.find("span", class_="documents_title")
                title = title_span.get_text(strip=True) if title_span else a.get_text(strip=True)
                
                if not href.startswith("http"):
                    href = "https://supreme.court.gov.ua" + href
                
                reviews.append({"title": title, "url": href})

        # Видаляємо дублікати
        unique_reviews = {r['url']: r for r in reviews}.values()
        return list(unique_reviews)

    except Exception as e:
        print(f"❌ Помилка підключення до ВС: {e}")
        return []
def _pdf_law_id(url: str) -> str:
    """Генерує стабільний law_id з URL PDF-файлу (без дати і індексу чанку)."""
    filename = url.rstrip("/").split("/")[-1]
    name = os.path.splitext(filename)[0]  # без .pdf
    # залишаємо тільки латиниця/цифри/дефіси, обрізаємо до 60 символів
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:60]
    return f"sc_{safe}"


def process_supreme_pdf(review_url, title, session_id=None, existing_ids=None):
    """Скачує PDF, парсить його та заливає в Supabase"""
    law_id = _pdf_law_id(review_url)

    if existing_ids and law_id in existing_ids:
        print(f"⏭️ Пропускаємо '{title}' — вже є в базі ({law_id})")
        return

    print(f"📥 Завантаження огляду: {title} ({law_id})...")
    time.sleep(3)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://supreme.court.gov.ua/supreme/pokazniki-diyalnosti/analiz/"
    }

    try:
        import requests
        response = requests.get(review_url, headers=headers, timeout=60)
        response.raise_for_status()

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(response.content)
            tmp_path = tmp.name

        print(f"📄 Файл скачано. Починаємо парсинг...")
        loader = PyPDFLoader(tmp_path)
        pages = loader.load()

        splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)
        chunks = splitter.split_documents(pages)

        scraped_at = datetime.now().isoformat()
        for i, chunk in enumerate(chunks):
            vector = embeddings.embed_query(chunk.page_content)
            metadata = {
                "source": title,
                "law_id": law_id,          # однаковий для всіх чанків цього PDF
                "category": "Судова практика",
                "law_url": review_url,
                "scraped_at": scraped_at,
                "chunk_index": i,
            }
            upload_chunk_to_supabase(chunk.page_content, metadata, vector, session_id=session_id)

        os.remove(tmp_path)
        print(f"✅ Огляд '{title}' додано в базу ({len(chunks)} чанків).")
    except Exception as e:
        print(f"❌ Помилка обробки PDF {title}: {e}")

def run_supreme_sync(session_id=None, log_callback=None):
    """Головна функція повної синхронізації судової практики"""
    def log(msg):
        print(msg)
        if log_callback:
            log_callback(msg)

    log("⚖️ Починаємо повний збір судової практики Верховного Суду...")
    reviews = get_supreme_reviews()

    # ПРИБРАНО ЛІМІТ: тепер використовуємо весь список reviews
    log(f"🔎 Всього знайдено оглядів: {len(reviews)}.")

    existing_ids = get_existing_law_ids()
    log(f"📋 Вже в базі: {len(existing_ids)} документів")

    # Перебираємо всі знайдени огляди
    for i, review in enumerate(reviews):
        log(f"📥 [{i+1}/{len(reviews)}] Обробка: {review['title']}")
        process_supreme_pdf(review['url'], review['title'], session_id=session_id, existing_ids=existing_ids)
        
        # Додаємо невелику паузу між файлами, щоб сайт ВС не заблокував за агресивний скрапінг
        time.sleep(2)

    log(f"✅ Синхронізація завершена. Оброблено документів: {len(reviews)}")

if __name__ == "__main__":
    run_supreme_sync()