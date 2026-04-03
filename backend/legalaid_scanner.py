# import httpx
# import time
# from bs4 import BeautifulSoup
# from datetime import datetime
# from rada_to_supabase import embeddings, upload_chunk_to_supabase, text_splitter

# # Базові налаштування
# BASE_URL = "https://legalaid.gov.ua"
# SECTION_URL = f"{BASE_URL}/kliyentam/yurydychni-konsultatsiyi/"
# HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# def get_legalaid_articles(limit=1):
#     """Шукає посилання на консультації БПД більш надійно"""
#     # Спробуємо основний розділ консультацій
#     url = "https://legalaid.gov.ua/publikatsiyi/yurydychni-konsultatsiyi/"
#     try:
#         r = httpx.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
#         soup = BeautifulSoup(r.text, "html.parser")
        
#         articles = []
#         # Шукаємо посилання в заголовках постів (класична верстка WordPress)
#         # Пробуємо кілька варіантів селекторів, які там зустрічаються
#         links = soup.select(".post-title a, .entry-title a, .category-page-item-title a")
        
#         if not links:
#             # Запасний варіант: шукаємо просто всі посилання всередині основного контенту
#             content = soup.find("main") or soup.find("div", id="content")
#             if content:
#                 links = content.find_all("a", href=True)

#         for a in links:
#             href = a['href']
#             title = a.get_text(strip=True)
#             # Фільтруємо, щоб це були саме посилання на статті, а не на категорії
#             if "/yurydychni-konsultatsiyi/" in href and len(title) > 10:
#                 articles.append({"title": title, "url": href})
            
#             if len(articles) >= limit:
#                 break
                
#         return articles
#     except Exception as e:
#         print(f"❌ Помилка пошуку на БПД: {e}")
#         return []

# def scrape_legalaid_article(url, title, session_id=None):
#     """Парсить статтю, шукає шаблони документів та заливає в базу"""
#     try:
#         print(f"📄 Обробка БПД: {title}...")
#         r = httpx.get(url, headers=HEADERS, timeout=20)
#         soup = BeautifulSoup(r.text, "html.parser")
        
#         content = soup.find("div", class_="entry-content")
#         if not content: return

#         # ШУКАЄМО ШАБЛОНИ (Ключовий момент!)
#         file_url = None
#         for link in content.find_all("a", href=True):
#             href = link['href']
#             # Перевіряємо розширення файлів
#             if any(ext in href.lower() for ext in ['.doc', '.docx', '.pdf', '.rtf']):
#                 file_url = href if href.startswith("http") else BASE_URL + href
#                 print(f"   📎 Знайдено файл: {file_url}")
#                 break 

#         text = content.get_text(separator="\n", strip=True)
#         chunks = text_splitter.split_text(text)

#         for i, chunk_text in enumerate(chunks):
#             vector = embeddings.embed_query(chunk_text)
            
#             # Пишемо все в метадані (JSONB)
#             metadata = {
#                 "source": f"БПД: {title}",
#                 "law_id": f"bpd_{datetime.now().strftime('%Y%m%d')}_{hash(url) % 10000}",
#                 "category": "Шаблони та інструкції",
#                 "law_url": url,
#                 "file_url": file_url,      # Посилання на скачування
#                 "is_template": bool(file_url), # Прапорець для логіки чату
#                 "scraped_at": datetime.now().isoformat(),
#                 "chunk_index": i
#             }
#             upload_chunk_to_supabase(chunk_text, metadata, vector, session_id=session_id)
#             time.sleep(0.5)

#         print(f"✅ Готово: {title}")
#     except Exception as e:
#         print(f"❌ Помилка БПД ({title}): {e}")

# def run_legalaid_sync(limit=2, session_id=None):
#     """Запуск синхронізації БПД з лімітом для тесту"""
#     print(f"🚀 Запуск БПД (ліміт: {limit})")
#     articles = get_legalaid_articles(limit=limit)
    
#     for art in articles:
#         scrape_legalaid_article(art['url'], art['title'], session_id=session_id)

# if __name__ == "__main__":
#     run_legalaid_sync(limit=1) # Зміни на None для повної синхронізації