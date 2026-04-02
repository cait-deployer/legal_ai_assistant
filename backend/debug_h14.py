"""
python debug_h14.py
Досліджуємо розділ h14 — збройні сили, мобілізація, безпека
"""
import requests
from bs4 import BeautifulSoup
import time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk-UA,uk;q=1.0",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Cookie": "lang=uk",
}
BASE = "https://zakon.rada.gov.ua"

def fetch(url):
    sep = "&" if "?" in url else "?"
    r = requests.get(f"{url}{sep}lang=uk", headers=HEADERS, timeout=15)
    return BeautifulSoup(r.text, "html.parser") if r.ok else None

def explore(url, label=""):
    soup = fetch(url)
    if not soup:
        print(f"❌ {url}")
        return [], []

    title = soup.find("title")
    print(f"\n📂 {label or url}")
    print(f"   Title: {title.text.strip()[:80] if title else '?'}")

    subsections = []
    law_links   = []

    for a in soup.find_all("a", href=True):
        href  = a["href"]
        text  = a.text.strip()
        if not text or len(text) < 4:
            continue
        # Пропускаємо навігаційне сміття
        if any(s in href for s in ["lang=", "dark=", "sps", "sp:", "stru2",
                                    "#", "mozilla", "google.com", "apple.com",
                                    "opera.com", "rnbo", "president", "kmu",
                                    "ccu", "firefox", "chrome", "safari",
                                    "rada.gov.ua/video", "itd.rada"]):
            continue

        full = href if href.startswith("http") else BASE + href

        if "/laws/show/" in href:
            law_links.append({"title": text, "url": full,
                               "id": href.split("/show/")[1].split("#")[0].strip()})
        elif "/laws/main/" in href and href != "/laws/main/a":
            code = href.replace("/laws/main/", "").strip("/")
            subsections.append({"title": text, "url": full, "code": code})

    # Дедуп
    seen = set()
    subsections = [s for s in subsections
                   if s["code"] not in seen and not seen.add(s["code"])]
    seen = set()
    law_links = [l for l in law_links
                 if l["id"] not in seen and not seen.add(l["id"])]

    print(f"   Підрозділів: {len(subsections)}")
    for s in subsections:
        print(f"     📁 [{s['code']:20s}] {s['title'][:65]}")

    print(f"   Законів на сторінці: {len(law_links)}")
    for l in law_links[:5]:
        print(f"     📄 {l['title'][:65]}")

    return subsections, law_links

def count_docs(code):
    """Скільки документів у розділі (дивимось лічильник на /page)"""
    soup = fetch(f"{BASE}/laws/main/{code}/page")
    if not soup:
        return "?"
    for tag in soup.find_all(string=True):
        t = tag.strip()
        if "документ" in t.lower() and any(c.isdigit() for c in t):
            import re
            m = re.search(r'(\d[\d\s]*)\s*$', t)
            if m:
                return m.group(1).replace(" ", "")
    links = [a for a in soup.find_all("a", href=True) if "/laws/show/" in a["href"]]
    return f"≥{len(links)}"

if __name__ == "__main__":
    print("=" * 60)
    print("Крок 1: Підрозділи h14")
    print("=" * 60)
    subs, laws = explore(f"{BASE}/laws/main/h14", "h14 — Збройні сили, безпека, надзвичайні заходи")

    if subs:
        print("\n" + "=" * 60)
        print("Крок 2: Заходимо в кожен підрозділ h14")
        print("=" * 60)
        all_subsubs = []
        for s in subs:
            subsubs, _ = explore(s["url"], f"{s['code']} — {s['title'][:50]}")
            all_subsubs.extend(subsubs)
            time.sleep(0.4)

        # Підсумок — всі кінцеві розділи з кількістю документів
        all_leaf = subs + all_subsubs
        print("\n" + "=" * 60)
        print("📊 ПІДСУМОК: всі розділи h14 з кількістю документів")
        print("=" * 60)
        total = 0
        for s in all_leaf:
            cnt = count_docs(s["code"])
            print(f"  [{s['code']:20s}] {s['title'][:55]:55s} | {cnt} docs")
            time.sleep(0.3)