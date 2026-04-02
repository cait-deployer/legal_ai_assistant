"""
python debug_search.py
Проверяем как работает поиск на сайте Рады
"""
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlencode

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk-UA,uk;q=0.9",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Referer": "https://zakon.rada.gov.ua/",
}

def search_rada(keyword: str, page: int = 1):
    """Пробуем разные варианты поискового запроса"""
    
    # Вариант 1: GET параметры
    params = {
        "find": keyword,
        "page": page,
    }
    url = f"https://zakon.rada.gov.ua/laws/main/a/page{'' if page == 1 else page}"
    
    print(f"\n{'='*60}")
    print(f"🔍 Поиск: '{keyword}' страница {page}")
    
    # Пробуем через search endpoint
    search_url = f"https://zakon.rada.gov.ua/laws/main/search?find={keyword}&page={page}"
    r = requests.get(search_url, headers=HEADERS, timeout=15)
    soup = BeautifulSoup(r.text, "html.parser")
    
    show_links = [(a.text.strip(), a["href"]) for a in soup.find_all("a", href=True) 
                  if "/laws/show/" in a["href"] and a.text.strip()]
    print(f"   search endpoint: {len(show_links)} результатов")
    for title, href in show_links[:5]:
        print(f"     - {title[:60]}")

    # Пробуем через /laws/main/search с POST
    search_url2 = "https://zakon.rada.gov.ua/laws/main/search"
    data = {
        "find": keyword,
        "type": "1",  # в названии
    }
    r2 = requests.post(search_url2, headers={**HEADERS, "Content-Type": "application/x-www-form-urlencoded"}, 
                       data=data, timeout=15)
    soup2 = BeautifulSoup(r2.text, "html.parser")
    show_links2 = [(a.text.strip(), a["href"]) for a in soup2.find_all("a", href=True) 
                   if "/laws/show/" in a["href"] and a.text.strip()]
    print(f"\n   POST search: {len(show_links2)} результатов")
    for title, href in show_links2[:5]:
        print(f"     - {title[:60]}")

    # Смотрим title страницы чтобы понять что вернулось
    title_tag = soup2.find("title")
    print(f"\n   Title: {title_tag.text if title_tag else '?'}")
    
    # Ищем счётчик документов типа "Документи 1-50 з 8150"
    for tag in soup2.find_all(string=True):
        if "документ" in tag.lower() and any(c.isdigit() for c in tag):
            print(f"   Счётчик: {tag.strip()[:100]}")

if __name__ == "__main__":
    keywords = ["мобілізація", "військовий обов'язок", "ТЦК", "призов"]
    for kw in keywords:
        search_rada(kw, page=1)