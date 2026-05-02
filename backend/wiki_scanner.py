
import os
import httpx
import time
import re
from datetime import datetime, timezone
import embed_v2
from qdrant_storage import upload_to_qdrant, delete_law_chunks as delete_old_law_chunks
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Використовуємо API поінт для MediaWiki
WIKI_API_URL = "https://legalaid.wiki/api.php"
WIKI_BASE_URL = "https://legalaid.wiki"
HEADERS = {"User-Agent": "LawyerAssistantBot/1.0 (Mariia Project)"}

text_splitter = RecursiveCharacterTextSplitter(chunk_size=1500, chunk_overlap=200)


def get_all_wiki_articles(stop_check=None):
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
            if stop_check and stop_check():
                break
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


def get_wiki_latest_articles(limit=50):
    """Отримує список нових сторінок через API."""
    params = {
        "action": "query",
        "list": "recentchanges",
        "rclimit": limit,
        "rcnamespace": 0,
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


def scrape_wiki_article(url, title, session_id=None, existing_ids=None):
    """Отримує чистий текст статті та завантажує в laws_wiki колекцію."""
    clean_id = re.sub(r'[^\w]', '_', title)
    law_id = f"wiki_{clean_id}"

    # Пропускаємо якщо вже є в базі
    if existing_ids and law_id in existing_ids:
        print(f"⏭️ Пропускаємо '{title}' — вже є в базі")
        return True

    params = {
        "action": "parse",
        "page": title,
        "prop": "text",
        "format": "json",
        "disableeditsection": 1,
    }

    try:
        r = httpx.get(WIKI_API_URL, params=params, headers=HEADERS, timeout=20)
        data = r.json().get("parse", {})

        html_content = data.get("text", {}).get("*", "")
        if not html_content:
            return False

        # Шукаємо посилання на файл (шаблон/документ)
        file_url = None
        file_match = re.search(r'href="([^"]+\.(?:docx?|pdf|rtf))"', html_content, re.I)
        if file_match:
            file_url = file_match.group(1)
            if not file_url.startswith("http"):
                file_url = WIKI_BASE_URL + file_url

        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html_content, "html.parser")
        for junk in soup.find_all(["table", "div"], class_=["toc", "mw-empty-elt", "navbox"]):
            junk.decompose()

        text = soup.get_text(separator="\n", strip=True)
        if len(text) < 200:
            return False

        # Пропускаємо статті не українською — кирилиця має бути > 30% тексту
        cyrillic = len(re.findall(r'[а-яА-ЯіїєёІЇЄЁ]', text))
        if cyrillic / max(len(text), 1) < 0.3:
            print(f"⏭️ Пропускаємо '{title}' — не українська мова ({cyrillic} кирил. симв.)")
            return False

        chunks = text_splitter.split_text(text)
        scraped_at = datetime.now(timezone.utc).isoformat()

        try:
            vectors = embed_v2.embed_documents(chunks, task="RETRIEVAL_DOCUMENT")
        except Exception as e:
            print(f"⚠️ Wiki embed error: {e}")
            return False

        for i, (chunk_text, vector) in enumerate(zip(chunks, vectors)):
            if vector is None:
                continue
            metadata = {
                "source": f"Wiki: {title}",
                "law_id": law_id,
                "category": "Роз'яснення та шаблони",
                "law_url": url,
                "source_domain": "legalaid.wiki",
                "file_url": file_url or "",
                "is_template": bool(file_url),
                "scraped_at": scraped_at,
                "chunk_index": i,
            }
            upload_to_qdrant(
                chunk_text, metadata, vector,
                collection_name="laws_wiki_v2",
                session_id=session_id,
            )

        print(f"✅ Wiki '{title}' → laws_wiki_v2 ({len(chunks)} чанків)")
        return True

    except Exception as e:
        print(f"❌ Помилка Wiki ({title}): {e}")
        return False


def run_wiki_sync(session_id=None, log_callback=None, full=True):
    """
    Головний цикл синхронізації Wiki → laws_wiki.
    full=True  → всі статті (get_all_wiki_articles)
    full=False → тільки нещодавні зміни (get_wiki_latest_articles)
    """
    from qdrant_storage import get_existing_law_ids

    def log(msg, level="info"):
        print(msg)
        if log_callback:
            log_callback(msg, level)

    log("📚 Починаємо синхронізацію legalaid.wiki → laws_wiki...")

    if full:
        articles = get_all_wiki_articles()
    else:
        articles = get_wiki_latest_articles(limit=100)

    log(f"🔎 Знайдено статей: {len(articles)}")

    existing_ids = get_existing_law_ids()
    log(f"📋 Вже в базі: {len(existing_ids)} документів")

    ok = 0
    for i, art in enumerate(articles):
        log(f"📖 [{i+1}/{len(articles)}] {art['title']}")
        if scrape_wiki_article(art["url"], art["title"], session_id=session_id, existing_ids=existing_ids):
            ok += 1
        time.sleep(1)

    log(f"✅ Wiki синхронізація завершена. Додано: {ok} статей.")


if __name__ == "__main__":
    run_wiki_sync(full=True)
