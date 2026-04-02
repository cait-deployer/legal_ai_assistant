"""
python debug_rada_api.py
"""
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk-UA,uk;q=0.9",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Referer": "https://zakon.rada.gov.ua/",
}

def check_url(url):
    print(f"\n{'='*60}")
    print(f"🔍 {url}")
    r = requests.get(url, headers=HEADERS, timeout=10)
    print(f"   Status: {r.status_code}")
    soup = BeautifulSoup(r.text, "html.parser")

    # Ссылки на законы
    show_links = [a["href"] for a in soup.find_all("a", href=True) if "/laws/show/" in a["href"]]
    print(f"   /laws/show/ ссылок: {len(show_links)}")
    for l in show_links[:5]:
        print(f"     {l}")

    # Ссылки пагинации
    pag = [a["href"] for a in soup.find_all("a", href=True) if "/page" in a.get("href", "")]
    print(f"   /page ссылок: {len(pag)}")
    for l in pag[:5]:
        print(f"     {l}")

    return len(show_links), r.text

if __name__ == "__main__":
    # Тест 1: базовый список кодексов через /page
    check_url("https://zakon.rada.gov.ua/laws/main/kodes/page")
    check_url("https://zakon.rada.gov.ua/laws/main/kodes/page2")

    # Тест 2: конституционные законы
    check_url("https://zakon.rada.gov.ua/laws/main/a/page")
    check_url("https://zakon.rada.gov.ua/laws/main/a/page2")

    # Тест 3: альтернативный формат через /go/
    check_url("https://zakon.rada.gov.ua/go/a/page")
    check_url("https://zakon.rada.gov.ua/go/a/page2")