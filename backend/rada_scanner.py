import requests
from bs4 import BeautifulSoup
import json
import os
import re
import time
import httpx
from markdownify import markdownify as md_convert

SCRAPED_INDEX_FILE = "scraped_index.json"
BASE = "https://zakon.rada.gov.ua"

# Заголовки для запитів — імітуємо звичайний браузер щоб сайт не блокував
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "uk-UA,uk;q=1.0",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Cookie": "lang=uk",
}

# ALL_THEMES (визначений нижче).
# Для автосинхронізації і ручного запуску без вибору → скрапиться ALL_THEMES.

# ─── TEST MODE ─────────────────────────────────────────────────────────────────
# Скільки документів брати з кожного розділу для тесту.
# Щоб скрапити ВСЕ — змінити на: TEST_DOCS_PER_SECTION = None
TEST_DOCS_PER_SECTION = 4
# ──────────────────────────────────────────────────────────────────────────────


# ─── ІНДЕКС (локальний JSON-файл) ─────────────────────────────────────────────
# Зберігаємо які закони вже скачали щоб не качати повторно при наступному запуску

def load_index() -> dict:
    """Завантажує індекс вже скачаних законів з файлу."""
    if os.path.exists(SCRAPED_INDEX_FILE):
        with open(SCRAPED_INDEX_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_index(index: dict):
    """Зберігає індекс у файл."""
    with open(SCRAPED_INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

def mark_as_scraped(index: dict, law_id: str, title: str, category: str):
    """Позначає закон як скачаний і одразу зберігає файл."""
    index[law_id] = {"title": title, "category": category}
    save_index(index)

def is_already_scraped(index: dict, law_id: str) -> bool:
    """Перевіряє чи вже є закон в індексі."""
    return law_id in index


# ПАГІНАЦІЯ: скільки сторінок у розділі

def get_total_pages(code: str) -> int:
    """
    Заходить на першу сторінку розділу і шукає кількість сторінок.
    Пробує два способи:
      1. Шукає посилання виду /laws/main/h14/page5 — беремо максимальне число
      2. Шукає текст "з 1234 документів" і рахуємо сторінки по 50
    """
    url = f"{BASE}/laws/main/{code}/page?lang=uk"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception:
        return 1

    max_page = 1

    # Спосіб 1: посилання пагінатора
    for a in soup.find_all("a", href=True):
        m = re.search(rf"/laws/main/{re.escape(code)}/page(\d+)", a["href"])
        if m:
            max_page = max(max_page, int(m.group(1)))

    # Спосіб 2: текст "з 1234 документів"
    for tag in soup.find_all(string=True):
        t = tag.strip()
        m = re.search(r'з\s+([\d\s]+)', t)
        if m and "документ" in t.lower():
            total_docs = int(m.group(1).replace(" ", ""))
            max_page = max(max_page, (total_docs + 49) // 50)
            break

    return max_page


# ПАРСИНГ СПИСКУ ЗАКОНІВ З ОДНІЄЇ СТОРІНКИ

def parse_laws_from_page(html: str, category: str) -> list[dict]:
    """
    Парсить HTML сторінки списку і витягує всі посилання на закони.
    Шукає всі <a href="/laws/show/..."> і бере ID та назву.
    """
    soup = BeautifulSoup(html, "html.parser")
    laws = []
    seen = set()

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/laws/show/" not in href:
            continue
        law_id = href.split("/show/")[1].split("#")[0].strip()
        title = a.text.strip()
        if law_id and title and law_id not in seen:
            seen.add(law_id)
            laws.append({"id": law_id, "title": title, "category": category})

    return laws


# ─── ЗБІР ЗАКОНІВ З ОДНОГО РОЗДІЛУ (ПОСТОРІНКОВО) ────────────────────────────

def get_laws_from_section(code: str, label: str, limit: int = None) -> list[dict]:
    """
    Проходить всі сторінки розділу і збирає список законів.
    limit — обмеження для тест-режиму (None = качаємо все).
    Пауза 0.8 сек між запитами щоб не отримати бан від сайту.
    """
    total_pages = get_total_pages(code)
    print(f"\n📂 [{code}] {label}")
    print(f"   Сторінок: {total_pages} (~{total_pages * 50} документів)")
    if limit:
        print(f"   ⚠️  TEST MODE: беремо перші {limit} документів")

    all_laws = []
    seen_ids = set()

    for page in range(1, total_pages + 1):
        if limit and len(all_laws) >= limit:
            break

        # Перша сторінка — без цифри в URL, решта — /page2, /page3 ...
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
            break  # Порожня сторінка = дійшли до кінця

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


# Повний список тем Ради (для UI вибору розділів)
ALL_THEMES: list[tuple[str, str]] = [
    ("h2",  "Банки, фінанси, кредит, бюджет"),
    ("h21", "Будівництво, капітальний ремонт, архітектура"),
    ("h3",  "Бухгалтерський облік, оподаткування, аудит, статистика"),
    ("h1",  "Господарсько-процесуальне законодавство"),
    ("h4",  "Державний та суспільний устрій (громадянство, паспорти)"),
    ("h6",  "Житлове законодавство. Житлово-комунальне господарство"),
    ("h31", "Загальні засади правового регулювання економіки"),
    ("h8",  "Законодавство про адміністративну відповідальність"),
    ("h27", "Кадрові питання. Нагородження"),
    ("h25", "Кримінальне та кримінально-процесуальне законодавство"),
    ("h10", "Ліцензування, сертифікація, патентування, метрологія"),
    ("h23", "Митна діяльність. Зовнішньоекономічні зв'язки (ЗЕД)"),
    ("h11", "Міжнародні відносини"),
    ("h12", "Наука, освіта, культура"),
    ("h13", "Нотаріат, адвокатура"),
    ("h16", "Охорона здоров'я, сім'я, молодь, спорт, туризм"),
    ("h14", "Охорона, безпека, правопорядок, збройні сили"),
    ("h15", "Підприємства та підприємницька діяльність, інвестиції"),
    ("h9",  "Природні ресурси, охорона довкілля, земельне право"),
    ("h29", "Проекти. Внесення змін до нормативних актів"),
    ("h17", "Промисловість, паливно-енергетичний комплекс"),
    ("h28", "Регіональне законодавство"),
    ("h18", "Сільське господарство, агропромисловий комплекс"),
    ("h20", "Соціальне забезпечення, страхування"),
    ("h22", "Суд, прокуратура, юстиція. Органи нагляду та контролю"),
    ("h30", "Судова практика"),
    ("h24", "Торгівля, громадське харчування, побутове обслуговування"),
    ("h7",  "Транспорт, зв'язок, інформація"),
    ("h19", "Трудові відносини, зайнятість населення, охорона праці"),
    ("h5",  "Цивільне та цивільно-процесуальне законодавство"),
    ("h26", "Цінні папери, фондовий ринок"),
    ("h32", "Ядерне законодавство. Ліквідація наслідків Чорнобиля"),
]


# ЗБІР ПО ВСІХ (або вибраних) РОЗДІЛАХ

def get_all_legal_ids(section_codes: list[str] | None = None) -> list[dict]:
    """
    Проходить по всіх (або вибраних) розділах і збирає список унікальних законів.
    section_codes — список кодів (наприклад ["h14", "h19"]); None = всі SECTIONS.
    Дедуплікація по law_id — один закон може бути в кількох розділах.
    """
    code_to_label = dict(ALL_THEMES)
    if section_codes:
        sections_to_scan = [(code, code_to_label.get(code, code)) for code in section_codes]
    else:
        sections_to_scan = list(ALL_THEMES)

    all_laws = []
    seen_ids = set()

    for code, label in sections_to_scan:
        section_laws = get_laws_from_section(code, label, limit=TEST_DOCS_PER_SECTION)
        for law in section_laws:
            if law["id"] not in seen_ids:
                seen_ids.add(law["id"])
                all_laws.append(law)

    print(f"\n📦 Разом унікальних документів: {len(all_laws)}")
    return all_laws


def get_new_laws(all_laws: list[dict], index: dict) -> list[dict]:
    """Фільтрує тільки ті закони яких ще немає в індексі."""
    new = [l for l in all_laws if not is_already_scraped(index, l["id"])]
    print(f"⏭️  Вже в індексі: {len(all_laws) - len(new)}  |  Нових: {len(new)}")
    return new


# МЕТАДАНІ ЗАКОНУ
# Замінює стару get_law_status() — тепер один запит дає всю потрібну інфу.
# Класи знайдені через DevTools на реальній сторінці zakon.rada.gov.ua:
#   <span class="valid">чинний</span>               — статус
#   <span class="dat0"><b>16.01.2024</b></span>      — дата прийняття
#   <span class="dat">01.03.2024</span>              — дата набрання чинності
#   <abbr data-original-title="Ідентифікатор">      — номер документа

def get_law_metadata(law_id: str) -> dict:
    """
    Повертає словник з метаданими закону:
      status         — "Чинний" / "Втратив чинність" / "Невідомо"
      doc_number     — номер документа, напр. "3553-IX"
      doc_type       — тип: Закон / Постанова / Указ / ...
      author         — орган: ВРУ / КМУ / Президент
      date_adopted   — дата прийняття: "16.01.2024"
      effective_date — дата набрання чинності: "01.03.2024"
    """
    url = f"{BASE}/laws/show/{law_id}?lang=uk"
    meta = {
        "status": "Невідомо",
        "doc_number": "",
        "doc_type": "",
        "author": "",
        "date_adopted": "",
        "effective_date": "",
    }

    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        # Статус: клас "valid" = чинний, "invalid" = скасований
        if soup.find("span", class_="valid"):
            meta["status"] = "Чинний"
        elif soup.find("span", class_="invalid"):
            meta["status"] = "Втратив чинність"

        # Номер документа з тега <abbr data-original-title="Ідентифікатор">
        abbr = soup.find("abbr", attrs={"data-original-title": re.compile(r"Ідентифікатор", re.I)})
        if abbr:
            meta["doc_number"] = abbr.get_text(strip=True)

        # Дата прийняття: <span class="dat0"><b>16.01.2024</b></span>
        dat0 = soup.find("span", class_="dat0")
        if dat0:
            b = dat0.find("b")
            meta["date_adopted"] = (b or dat0).get_text(strip=True)

        # Дата набрання чинності: <span class="dat"> всередині блоку text-muted
        muted = soup.find("div", class_=re.compile(r"text-muted"))
        if muted:
            dat = muted.find("span", class_="dat")
            if dat:
                meta["effective_date"] = dat.get_text(strip=True)

        # Тип документа і орган — шукаємо в тексті блоку div.doc
        doc_div = soup.find("div", class_="doc")
        header_text = doc_div.get_text(" ", strip=True)[:400] if doc_div else ""

        type_match = re.search(
            r"\b(Закон|Постанова|Указ|Кодекс|Наказ|Розпорядження|Декрет|Рішення)\b",
            header_text, re.I
        )
        if type_match:
            meta["doc_type"] = type_match.group(1).capitalize()

        if re.search(r"Верховна Рада|Закон України", header_text, re.I):
            meta["author"] = "Верховна Рада України"
        elif re.search(r"Президент", header_text, re.I):
            meta["author"] = "Президент України"
        elif re.search(r"Кабінет Міністрів|КМУ", header_text, re.I):
            meta["author"] = "Кабінет Міністрів України"

    except Exception as e:
        print(f"   ⚠️ get_law_metadata({law_id}): {e}")

    return meta


# ТЕКСТ ЗАКОНУ

def get_law_text(law_id: str) -> str:
    """
    Завантажує повний текст закону.
    Основний метод: URL /print — статична сторінка без JavaScript,
    містить чистий текст закону без UI-сміття.
    Запасний варіант: звичайна сторінка, шукаємо div#lawContentBody.
    """
    # ── Фрази що означають відсутність публічного тексту ────────────────────
    _RESTRICTED_PHRASES = (
        "для службового використання",
        "не підлягає опублікуванню",
        "текст документа не оприлюднюється",
        "доступ до цього документа обмежено",
    )

    def _is_restricted(text: str) -> bool:
        low = text.lower()
        return any(p in low for p in _RESTRICTED_PHRASES)

    # ── Спроба 1: /print — завжди статичний, без JS-рендерингу ──────────────
    print_url = f"{BASE}/laws/show/{law_id}/print"
    try:
        r = httpx.get(print_url, headers=HEADERS, timeout=20.0, follow_redirects=True)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            container = soup.find("div", id="article") or soup.find("body")
            if container:
                for junk in container.find_all(["script", "style", "nav", "button",
                                                "form", "header", "footer"]):
                    junk.decompose()
                md = md_convert(
                    str(container),
                    heading_style="ATX",
                    strip=["script", "style", "nav", "button", "form", "header", "footer"],
                )
                md = re.sub(r'\n{3,}', '\n\n', md).strip()
                if len(md) > 100:
                    if _is_restricted(md):
                        print(f"🔒 {law_id}: службового використання — пропускаємо")
                        return ""
                    return md
    except Exception as e:
        print(f"⚠️  get_law_text /print ({law_id}): {e}")

    # ── Спроба 2: звичайна сторінка, шукаємо lawContentBody ─────────────────
    url = f"{BASE}/laws/show/{law_id}#Text"
    try:
        r = httpx.get(url, headers=HEADERS, timeout=20.0, follow_redirects=True)
        if r.status_code != 200:
            return ""

        soup = BeautifulSoup(r.text, "html.parser")
        container = (
            soup.find("div", id="lawContentBody") or
            soup.find("div", id="Text") or
            soup.find("div", class_="article")
        )
        if not container:
            return ""

        for junk in container.find_all(["script", "style", "nav", "button", "form"]):
            junk.decompose()

        md = md_convert(str(container), heading_style="ATX")
        md = re.sub(r'\n{3,}', '\n\n', md).strip()
        if len(md) > 100:
            if _is_restricted(md):
                print(f"🔒 {law_id}: службового використання — пропускаємо")
                return ""
            return md
        return ""

    except Exception as e:
        print(f"❌ get_law_text({law_id}): {e}")
        return ""


# ─── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    all_laws = get_all_legal_ids()
    index = load_index()
    new_laws = get_new_laws(all_laws, index)
    print(f"\nПерші 10 нових:")
    for law in new_laws[:10]:
        print(f"  [{law['category']}] {law['title'][:65]} (ID: {law['id']})")
