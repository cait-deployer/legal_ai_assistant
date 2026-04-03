"""
python debug_classifier.py
Знаходимо тематичну класифікацію Ради (stru8 = Теми)
"""
import requests
from bs4 import BeautifulSoup
import time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk-UA,uk;q=1.0",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Referer": "https://zakon.rada.gov.ua/",
    "Cookie": "lang=uk",
}
BASE = "https://zakon.rada.gov.ua"

MILITARY_KEYWORDS = [
    "військ", "оборон", "мобіліз", "збройн", "призов",
    "воєнн", "тцк", "нацгвард", "безпек", "надзвичайн",
    "територіальн", "резервіст", "ветеран", "бойов",
]

def fetch(url):
    sep = "&" if "?" in url else "?"
    r = requests.get(f"{url}{sep}lang=uk", headers=HEADERS, timeout=15)
    return BeautifulSoup(r.text, "html.parser") if r.ok else None

def get_theme_sections():
    """
    Рада має тематичну класифікацію на /laws/main/a/stru8
    Це дерево тем — без нескінченної навігації
    """
    # Бачили в виводі: [a/stru8/sps#Temy] Класифікація документів
    urls_to_try = [
        f"{BASE}/laws/main/a/stru8",
        f"{BASE}/laws/main/a/page/stru8",
        f"{BASE}/laws/stru8/a",
    ]

    for url in urls_to_try:
        print(f"\n🔍 Пробую: {url}?lang=uk")
        soup = fetch(url)
        if not soup:
            print("   ❌ Недоступно")
            continue

        title = soup.find("title")
        print(f"   Title: {title.text.strip()[:80] if title else '?'}")

        # Шукаємо всі посилання що схожі на розділи (не навігація)
        all_links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.text.strip()
            # Пропускаємо навігаційне сміття
            if any(skip in href for skip in ["lang=", "dark=", "/sps", "/sp:", "stru2", "#"]):
                continue
            if not text or len(text) < 5:
                continue
            all_links.append((text, href))

        print(f"   Чистих посилань: {len(all_links)}")
        for text, href in all_links[:30]:
            print(f"     {href:45s} | {text[:60]}")

        if all_links:
            # Фільтруємо військові
            mil = [(t, h) for t, h in all_links
                   if any(kw in t.lower() for kw in MILITARY_KEYWORDS)]
            print(f"\n   🎯 Військових розділів: {len(mil)}")
            for t, h in mil:
                print(f"     ✅ {h:45s} | {t}")
            break
        time.sleep(0.5)

def get_search_by_theme():
    """
    Альтернатива: використовуємо пошук Ради через правильний endpoint
    Бачили в виводі: [a#Find] Пошук → /laws/main/a#Find
    """
    print(f"\n{'='*60}")
    print("🔍 Тестуємо пошук через /laws/main/search з правильними параметрами")

    # Пробуємо різні варіанти пошукового запиту
    test_queries = [
        {"word0": "мобілізація", "type0": "1"},   # в назві
        {"find": "мобілізація"},
        {"query": "мобілізація"},
    ]

    for params in test_queries:
        url = f"{BASE}/laws/main/search"
        r = requests.get(url, params={**params, "lang": "uk"}, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
        title = soup.find("title")
        links = [a for a in soup.find_all("a", href=True) if "/laws/show/" in a["href"]]
        print(f"\n   Params: {params}")
        print(f"   Status: {r.status_code} | Title: {title.text.strip()[:60] if title else '?'}")
        print(f"   Законів знайдено: {len(links)}")
        for a in links[:3]:
            print(f"     - {a.text.strip()[:70]}")

if __name__ == "__main__":
    print("=" * 60)
    print("КРОК 1: Тематична класифікація (stru8)")
    print("=" * 60)
    get_theme_sections()

    print("\n" + "=" * 60)
    print("КРОК 2: Тест пошуку")
    print("=" * 60)
    get_search_by_theme()