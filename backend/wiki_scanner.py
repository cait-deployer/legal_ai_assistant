
import os
import httpx
import time
import re
from datetime import datetime
from rada_to_supabase import embeddings, upload_chunk_to_supabase, text_splitter, delete_old_law_chunks, get_existing_laws_meta

# Використовуємо API поінт для MediaWiki
WIKI_API_URL = "https://legalaid.wiki/api.php"
WIKI_BASE_URL = "https://legalaid.wiki"
HEADERS = {"User-Agent": "LawyerAssistantBot/1.0 (Mariia Project)"}

def get_all_wiki_articles():
    """Отримує ВСІ статті з legalaid.wiki через API allpages (з пагінацією)."""
    articles = []
    params = {
        "action": "query",
        "list": "allpages",
        "aplimit": "max",   # max = 500 за запит
        "apnamespace": 0,   # Тільки основні статті
        "format": "json",
    }
    try:
        while True:
            r = httpx.get(WIKI_API_URL, params=params, headers=HEADERS, timeout=30)
            data = r.json()
            for page in data.get("query", {}).get("allpages", []):
                title = page["title"]
                articles.append({
                    "title": title,
                    "url": f"{WIKI_BASE_URL}/index.php/{title.replace(' ', '_')}",
                })
            cont = data.get("continue", {})
            if not cont:
                break
            params.update(cont)
            time.sleep(0.3)
    except Exception as e:
        print(f"❌ Помилка отримання списку allpages: {e}")
    return articles


def get_wiki_latest_articles(limit=2):
    """Отримує список нових сторінок через API (набагато надійніше)"""
    params = {
        "action": "query",
        "list": "recentchanges",
        "rclimit": limit,
        "rcnamespace": 0,  # Тільки основні статті
        "format": "json"
    }
    try:
        r = httpx.get(WIKI_API_URL, params=params, headers=HEADERS, timeout=20)
        data = r.json()
        articles = []
        for change in data.get("query", {}).get("recentchanges", []):
            articles.append({
                "title": change["title"],
                "url": f"{WIKI_BASE_URL}/index.php/{change['title']}"
            })
        return articles
    except Exception as e:
        print(f"❌ Помилка отримання списку через API: {e}")
        return []

def scrape_wiki_article(url, title, session_id=None, existing_meta=None):
    """Отримує чистий текст статті та оновлює базу, якщо потрібно."""
    clean_id = re.sub(r'[^\w]', '_', title)
    law_id = f"wiki_{clean_id}"

    # ПЕРЕВІРКА ДАТИ: Wiki оновлюємо раз на 14 днів
    if existing_meta and law_id in existing_meta:
        meta = existing_meta[law_id]
        scraped_at_str = meta.get("scraped_at", "") if isinstance(meta, dict) else str(meta)
        try:
            last_scraped = datetime.fromisoformat(scraped_at_str.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc) if last_scraped.tzinfo else datetime.now()
            if (now - last_scraped).days < 14:
                return True  # Пропускаємо, ще свіжа
        except Exception:
            pass
        
        # Якщо застаріла — видаляємо старе перед записом
        delete_old_law_chunks(law_id)
  
    # 1. Запит на отримання контенту сторінки
    params = {
        "action": "parse",
        "page": title,
        "prop": "text|links|iwlinks", # Отримуємо текст і посилання
        "format": "json",
        "disableeditsection": 1
    }
    
    try:
        r = httpx.get(WIKI_API_URL, params=params, headers=HEADERS, timeout=20)
        data = r.json().get("parse", {})
        
        # Отримуємо чистий HTML контенту
        html_content = data.get("text", {}).get("*", "")
        if not html_content: return False

        # Швидкий пошук шаблонів документів у тексті (регулярним виразом)
        file_url = None
        file_match = re.search(r'href="([^"]+\.(?:docx?|pdf|rtf))"', html_content, re.I)
        if file_match:
            file_url = file_match.group(1)
            if not file_url.startswith("http"):
                file_url = WIKI_BASE_URL + file_url

        # Очищаємо текст від HTML-тегів (MediaWiki API віддає HTML, але без сміття навігації)
        from bs4 import BeautifulSoup # Залишаємо тільки для фінального очищення тексту
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Видаляємо технічні блоки, якщо вони лишилися
        for junk in soup.find_all(["table", "div"], class_=["toc", "mw-empty-elt", "navbox"]):
            junk.decompose()
            
        text = soup.get_text(separator="\n", strip=True)
        if len(text) < 200: return False

        # Далі стандартний процес чанкування та завантаження
        chunks = text_splitter.split_text(text)
        scraped_at = datetime.now().isoformat()
        clean_id = re.sub(r'[^\w]', '_', title)
        law_id = f"wiki_{clean_id}"

        for i, chunk_text in enumerate(chunks):
            vector = embeddings.embed_query(chunk_text)
            metadata = {
                "source": f"Wiki: {title}",
                "law_id": law_id,
                "category": "Роз'яснення та шаблони",
                "law_url": url,
                "file_url": file_url,
                "is_template": bool(file_url),
                "scraped_at": scraped_at,
                "chunk_index": i
            }
            upload_chunk_to_supabase(chunk_text, metadata, vector, session_id=session_id)
            time.sleep(0.3)
            
        return True
    except Exception as e:
        print(f"❌ Помилка API Wiki ({title}): {e}")
        return False

def run_wiki_sync(limit=2, session_id=None, log_callback=None):
    """Головний цикл синхронізації"""
    def log(msg):
        print(msg)
        if log_callback: log_callback(msg)

    articles = get_wiki_latest_articles(limit=limit)
    log(f"📚 Знайдено {len(articles)} статей на Wiki...")
    
    for art in articles:
        log(f"📖 Обробка: {art['title']}")
        success = scrape_wiki_article(art['url'], art['title'], session_id=session_id)
        if success:
            log(f"✅ Готово: {art['title']}")
        time.sleep(1)

if __name__ == "__main__":
    run_wiki_sync(limit=None) # Зміни на None для повної синхронізації