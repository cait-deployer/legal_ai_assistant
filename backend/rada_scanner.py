import requests
from bs4 import BeautifulSoup
import json
import os
import re
import time

SCRAPED_INDEX_FILE = "scraped_index.json"
BASE = "https://zakon.rada.gov.ua"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk-UA,uk;q=1.0",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Cookie": "lang=uk",
}

# ─── Розділи для сканування ────────────────────────────────────────────────────
SECTIONS = [
    ("h14", "Збройні сили, безпека, мобілізація"),
    ("h25", "Кримінальне право"),
    ("h19", "Трудові відносини, бронювання"),
    ("h20", "Соціальне забезпечення, ветерани"),
]

# ─── TEST MODE ─────────────────────────────────────────────────────────────────
# Скільки документів брати з кожного розділу для тесту.
# Щоб скрапити ВСЕ — змінити на: TEST_DOCS_PER_SECTION = None
TEST_DOCS_PER_SECTION = 5
# ──────────────────────────────────────────────────────────────────────────────

# ─── Індекс ────────────────────────────────────────────────────────────────────

def load_index() -> dict:
    if os.path.exists(SCRAPED_INDEX_FILE):
        with open(SCRAPED_INDEX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_index(index: dict):
    with open(SCRAPED_INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

def mark_as_scraped(index: dict, law_id: str, title: str, category: str):
    index[law_id] = {"title": title, "category": category}
    save_index(index)

def is_already_scraped(index: dict, law_id: str) -> bool:
    return law_id in index

# ─── Кількість сторінок у розділі ─────────────────────────────────────────────

def get_total_pages(code: str) -> int:
    url = f"{BASE}/laws/main/{code}/page?lang=uk"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception:
        return 1

    max_page = 1
    for a in soup.find_all("a", href=True):
        m = re.search(rf"/laws/main/{re.escape(code)}/page(\d+)", a["href"])
        if m:
            max_page = max(max_page, int(m.group(1)))

    for tag in soup.find_all(string=True):
        t = tag.strip()
        m = re.search(r'з\s+([\d\s]+)', t)
        if m and "документ" in t.lower():
            total_docs = int(m.group(1).replace(" ", ""))
            max_page = max(max_page, (total_docs + 49) // 50)
            break

    return max_page

# ─── Парсинг одної сторінки ────────────────────────────────────────────────────

def parse_laws_from_page(html: str, category: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    laws = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/laws/show/" not in href:
            continue
        law_id = href.split("/show/")[1].split("#")[0].strip()
        title  = a.text.strip()
        if law_id and title and law_id not in seen:
            seen.add(law_id)
            laws.append({"id": law_id, "title": title, "category": category})
    return laws

# ─── Збір законів з одного розділу ────────────────────────────────────────────

def get_laws_from_section(code: str, label: str, limit: int = None) -> list[dict]:
    """
    Сканує розділ посторінково.
    limit — максимум документів (None = всі).
    """
    total_pages = get_total_pages(code)
    print(f"\n📂 [{code}] {label}")
    print(f"   Сторінок: {total_pages} (~{total_pages*50} документів)")
    if limit:
        print(f"   ⚠️  TEST MODE: беремо перші {limit} документів")

    all_laws = []
    seen_ids = set()

    for page in range(1, total_pages + 1):
        if limit and len(all_laws) >= limit:
            break

        suffix = "" if page == 1 else str(page)
        url = f"{BASE}/laws/main/{code}/page{suffix}?lang=uk"

        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            r.raise_for_status()
        except requests.RequestException as e:
            print(f"   ❌ Стор. {page}: {e}")
            time.sleep(3)
            continue

        page_laws = parse_laws_from_page(r.text, code)

        if not page_laws:
            break

        for law in page_laws:
            if law["id"] not in seen_ids:
                seen_ids.add(law["id"])
                all_laws.append(law)
                if limit and len(all_laws) >= limit:
                    break

        print(f"   📄 Стор. {page}: всього зібрано {len(all_laws)}")
        time.sleep(0.8)

    print(f"   ✅ Зібрано з [{code}]: {len(all_laws)}")
    return all_laws

# ─── Збір по всіх розділах ────────────────────────────────────────────────────

def get_all_legal_ids() -> list[dict]:
    all_laws = []
    seen_ids = set()

    for code, label in SECTIONS:
        section_laws = get_laws_from_section(
            code, label,
            limit=TEST_DOCS_PER_SECTION
        )
        for law in section_laws:
            if law["id"] not in seen_ids:
                seen_ids.add(law["id"])
                all_laws.append(law)

    print(f"\n📦 Разом унікальних документів: {len(all_laws)}")
    return all_laws

def get_new_laws(all_laws: list[dict], index: dict) -> list[dict]:
    new = [l for l in all_laws if not is_already_scraped(index, l["id"])]
    print(f"⏭️  Вже в індексі: {len(all_laws) - len(new)}  |  Нових: {len(new)}")
    return new

# ─── Статус закону (НОВА ФУНКЦІЯ — нічого не ламає) ───────────────────────────

def get_law_status(law_id: str) -> str:
    """
    Робить окремий GET-запит на сторінку закону і витягує його статус.
    Повертає рядок: 'Чинний', 'Втратив чинність' або 'Невідомо'.
    Не змінює сигнатуру get_law_text(), тому нічого не ламає.
    """
    url = f"{BASE}/laws/show/{law_id}?lang=uk"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        # Рада використовує кілька варіантів розмітки — перевіряємо всі
        tag = (
            soup.find("span", class_="status") or
            soup.find("div", class_="doc-status") or
            soup.find("span", class_="law-status") or
            # Fallback: шукаємо текст безпосередньо
            soup.find("span", string=re.compile(r"(Чинний|Втратив чинність)", re.I)) or
            soup.find("div",  string=re.compile(r"(Чинний|Втратив чинність)", re.I))
        )

        if tag:
            return tag.get_text(strip=True)

        # Останній резервний варіант — шукаємо в усьому тексті сторінки
        full_text = soup.get_text()
        if re.search(r"Втратив чинність", full_text, re.I):
            return "Втратив чинність"
        if re.search(r"Чинний", full_text, re.I):
            return "Чинний"

        return "Невідомо"

    except Exception as e:
        print(f"   ⚠️ Не вдалось отримати статус для {law_id}: {e}")
        return "Невідомо"

# ─── Текст закону (БЕЗ ЗМІН) ──────────────────────────────────────────────────

def get_law_text(law_id: str) -> str | None:
    url = f"{BASE}/laws/show/{law_id}/print?lang=uk"
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"   ❌ {law_id}: {e}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    content = soup.find("div", class_="txt") or soup.find("body")
    if not content:
        return None

    text = content.get_text(separator="\n", strip=True)
    return text if len(text) >= 200 else None

# ─── main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    all_laws = get_all_legal_ids()
    index    = load_index()
    new_laws = get_new_laws(all_laws, index)
    print(f"\nПерші 10 нових:")
    for law in new_laws[:10]:
        print(f"  [{law['category']}] {law['title'][:65]} (ID: {law['id']})")

#         python -c "
# from rada_scanner import get_all_legal_ids, load_index, get_new_laws
# import rada_scanner; rada_scanner.MAX_PAGES = 5
# laws = get_all_legal_ids(max_pages=5)
# print('Первые 5:', laws[:5])
# "