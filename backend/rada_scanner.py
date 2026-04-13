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
TEST_DOCS_PER_SECTION = None
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
    """Повертає кількість сторінок. Залишено для сумісності."""
    return get_section_doc_count(code)[1]  # tuple[count, pages, is_exact]


def _parse_doc_count_from_soup(soup, code: str) -> tuple[int | None, int]:
    """Внутрішній хелпер: витягує (exact_count_or_None, max_page) з BeautifulSoup."""
    max_page = 1
    # Пагінатор — для кількості сторінок
    for a in soup.find_all("a", href=True):
        m = re.search(rf"/laws/main/{re.escape(code)}/page(\d+)", a["href"])
        if m:
            max_page = max(max_page, int(m.group(1)))

    # Точне число документів з тексту сторінки
    full_text = soup.get_text(" ", strip=True).replace("\xa0", " ")
    for pattern in [
        r'—\s*([\d][\d\s]{0,7}[\d])\s*документ',   # "— 8 779 документів" (заголовок Ради)
        r'з\s+([\d][\d\s]{0,7}[\d])\s*документ',    # "з 4 128 документів"
        r'([\d][\d\s]{0,7}[\d])\s*документ',         # "4 128 документів"
        r'Знайдено[:\s]+([\d][\d\s]{0,7}[\d])',      # "Знайдено: 4128"
        r'всього\s+([\d][\d\s]{0,7}[\d])',            # "всього 4128"
    ]:
        m = re.search(pattern, full_text, re.IGNORECASE)
        if m:
            raw = m.group(1).replace(" ", "").replace("\xa0", "")
            if raw.isdigit() and int(raw) > 0:
                return int(raw), max(max_page, (int(raw) + 49) // 50)

    return None, max_page


def get_section_doc_count(code: str) -> tuple[int, int, bool]:
    """
    Повертає (exact_count, total_pages, is_exact) для розділу Ради.
    Запитує ОБИДВІ сторінки:
      1. /laws/main/{code}        → заголовок "— 8 779 документів"
      2. /laws/main/{code}/page   → пагінатор для кількості сторінок
    is_exact=True якщо знайдено точне число, False — fallback pages*50.
    """
    def _get(url: str):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            return BeautifulSoup(r.text, "html.parser")
        except Exception:
            return None

    # Спочатку головна сторінка розділу (там є заголовок з точним числом)
    main_soup = _get(f"{BASE}/laws/main/{code}?lang=uk")
    page_soup = _get(f"{BASE}/laws/main/{code}/page?lang=uk")

    max_page = 1
    exact_count: int | None = None

    for soup in filter(None, [main_soup, page_soup]):
        cnt, pg = _parse_doc_count_from_soup(soup, code)
        max_page = max(max_page, pg)
        if cnt is not None and exact_count is None:
            exact_count = cnt

    if exact_count is None:
        return max_page * 50, max_page, False

    return exact_count, max(max_page, (exact_count + 49) // 50), True


def parse_laws_from_page(html: str, category: str) -> list[dict]:
    """
    Парсить HTML сторінки списку і витягує всі посилання на закони.
    Шукає всі <a href="/laws/show/..."> і бере ID, назву та дату редакції.
    Дата береться з рядка таблиці (<tr>) без додаткового запиту.
    """
    soup = BeautifulSoup(html, "html.parser")
    laws = []
    seen = set()
    _DATE_RE = re.compile(r'\b(\d{2}\.\d{2}\.\d{4})\b')

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/laws/show/" not in href:
            continue
        law_id = href.split("/show/")[1].split("#")[0].strip()
        title = a.text.strip()
        if not (law_id and title and law_id not in seen):
            continue
        seen.add(law_id)

        # Шукаємо дату редакції в найближчому рядку таблиці (<tr>).
        # Рада відображає дату прийняття/редакції поряд з назвою закону.
        # Якщо <tr> немає або дати нема — list_date залишається порожнім (safe fallback).
        list_date = ""
        row = a.find_parent("tr")
        if row:
            m = _DATE_RE.search(row.get_text())
            if m:
                list_date = m.group(1)

        laws.append({"id": law_id, "title": title, "category": category, "list_date": list_date})

    return laws


# ─── ЗБІР ЗАКОНІВ З ОДНОГО РОЗДІЛУ (ПОСТОРІНКОВО) ────────────────────────────

def get_laws_from_section(code: str, label: str, limit: int = None, log=None) -> list[dict]:
    """
    Проходить всі сторінки розділу і збирає список законів.
    limit — обмеження для тест-режиму (None = качаємо все).
    log — callback(message, level) для виводу в UI; якщо None — print.
    """
    _log = log if log else (lambda m, lv="info": print(m))

    total_pages = get_total_pages(code)
    _log(f"📂 Розділ [{code}] {label} — {total_pages} стор. (~{total_pages * 50} doc)")
    if limit:
        _log(f"   ⚠️  TEST MODE: беремо перші {limit} документів", "warning")

    all_laws = []
    seen_ids = set()

    for page in range(1, total_pages + 1):
        if limit and len(all_laws) >= limit:
            break

        # Перша сторінка — без /page, решта — /page2, /page3 ...
        if page == 1:
            url = f"{BASE}/laws/main/{code}?lang=uk"
        else:
            url = f"{BASE}/laws/main/{code}/page{page}?lang=uk"

        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            r.raise_for_status()
        except requests.RequestException as e:
            _log(f"   ❌ Стор. {page}: {e}", "error")
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

        _log(f"   📄 Стор. {page}/{total_pages}: зібрано {len(all_laws)}")
        time.sleep(0.3)

    _log(f"   ✅ [{code}] готово: {len(all_laws)} законів", "success")
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

def get_all_legal_ids(section_codes: list[str] | None = None, log=None) -> list[dict]:
    """
    Проходить по всіх (або вибраних) розділах і збирає список унікальних законів.
    section_codes — список кодів (наприклад ["h14", "h19"]); None = всі SECTIONS.
    log — callback(message, level) для виводу в UI.
    Дедуплікація по law_id — один закон може бути в кількох розділах.
    """
    _log = log if log else (lambda m, lv="info": print(m))

    code_to_label = dict(ALL_THEMES)
    if section_codes:
        sections_to_scan = [(code, code_to_label.get(code, code)) for code in section_codes]
    else:
        sections_to_scan = list(ALL_THEMES)

    total_sections = len(sections_to_scan)
    all_laws = []
    seen_ids = set()

    for idx, (code, label) in enumerate(sections_to_scan, 1):
        _log(f"📡 Сканування розділу {idx}/{total_sections}: [{code}] {label}")
        section_laws = get_laws_from_section(code, label, limit=TEST_DOCS_PER_SECTION, log=_log)
        for law in section_laws:
            if law["id"] not in seen_ids:
                seen_ids.add(law["id"])
                all_laws.append(law)

    _log(f"📦 Сканування завершено: {len(all_laws)} унікальних документів", "success")
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
      status          — "Чинний" / "Втратив чинність" / "Невідомо"
      doc_number      — номер документа, напр. "3553-IX"
      doc_type        — тип: Закон / Постанова / Указ / ...
      author          — орган: ВРУ / КМУ / Президент
      date_adopted    — дата прийняття: "16.01.2024"
      effective_date  — дата набрання чинності: "01.03.2024"
      superseded_by   — id закону-підстави (наприклад "z1249-07"), "" якщо немає
    """
    url = f"{BASE}/laws/show/{law_id}?lang=uk"
    meta = {
        "status": "Невідомо",
        "doc_number": "",
        "doc_type": "",
        "author": "",
        "date_adopted": "",
        "effective_date": "",
        "superseded_by": "",
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

        # Підстава (superseded_by): посилання поряд з текстом "підстава"
        # Рада показує: "поточна редакція — Редакція від XX.XX.XXXX, підстава — zXXXX-XX"
        page_text = soup.get_text(" ")
        basis_match = re.search(r"підстава\s*[—-]\s*([a-zA-Z0-9\-]+)", page_text, re.I)
        if basis_match:
            meta["superseded_by"] = basis_match.group(1).strip()
        else:
            # Запасний варіант: шукаємо посилання /laws/show/XXXX поряд з "підстава"
            for a in soup.find_all("a", href=re.compile(r"/laws/show/")):
                parent_text = (a.parent or a).get_text(" ", strip=True).lower()
                if "підстав" in parent_text:
                    basis_id = a["href"].split("/show/")[1].split("#")[0].strip()
                    meta["superseded_by"] = basis_id
                    break

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


# ── REGEX-ФЛАГИ З ТЕКСТУ ЗАКОНУ ───────────────────────────────────────────────

_RETROACTIVE_RE = [
    re.compile(r"поширюється на відносини.{0,60}до набрання чинності", re.I),
    re.compile(r"зворотн.{0,15}сил", re.I),
    re.compile(r"набирає чинності з \d{2}\.\d{2}\.\d{4}", re.I),
]
_WARTIME_RE = re.compile(
    r"на період воєнного стану|в умовах воєнного стану|дію воєнного стану", re.I
)
_SUSPENDED_RE = re.compile(
    r"призупин(ити|яється|ено)\s+дію|мораторі[йю]|зупин(ити|яється|ено)\s+дію", re.I
)
_TRANSITIONAL_RE = re.compile(
    r"прикінцев[іи]\s+положення|перехідн[іи]\s+положення", re.I
)


def detect_text_flags(text: str) -> dict:
    """
    Аналізує текст закону регулярками і повертає булеві флаги.
    Викликається при чанкінгу — безкоштовно, без LLM.
    """
    return {
        "is_retroactive":    any(p.search(text) for p in _RETROACTIVE_RE),
        "wartime_only":      bool(_WARTIME_RE.search(text)),
        "is_suspended":      bool(_SUSPENDED_RE.search(text)),
        "has_transitional":  bool(_TRANSITIONAL_RE.search(text)),
    }


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

    _JUNK_TAGS = ["script", "style", "nav", "button", "form", "header", "footer",
                  "noscript", "iframe", "aside"]

    def _extract_md(container) -> str:
        for junk in container.find_all(_JUNK_TAGS):
            junk.decompose()
        md = md_convert(str(container), heading_style="ATX",
                        strip=_JUNK_TAGS)
        return re.sub(r'\n{3,}', '\n\n', md).strip()

    def _find_container(soup):
        """Перебирає всі відомі контейнери тексту закону по пріоритету."""
        return (
            soup.find("div", id="article")         or   # /print — основний
            soup.find("div", id="lawText")         or   # альтернативна /print
            soup.find("div", id="lawContentBody")  or   # звичайна сторінка
            soup.find("div", id="norms")           or   # деякі кодекси
            soup.find("div", id="Text")            or   # стара розмітка
            soup.find("div", id="text")            or   # ID в нижньому регістрі
            soup.find("div", class_="article")     or   # клас
            soup.find("div", class_="txt")         or   # ще один клас
            soup.find("div", class_="law-text")    or   # можлива розмітка
            soup.find("article")                   or   # семантичний тег
            soup.find("main")                           # семантичний тег
        )

    # ── Спроба 1: /print — статична сторінка без JavaScript ──────────────────
    print_url = f"{BASE}/laws/show/{law_id}/print"
    try:
        r = httpx.get(print_url, headers=HEADERS, timeout=20.0, follow_redirects=True)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            container = _find_container(soup)
            if not container:
                # Крайній fallback: весь body без шапки/навігації
                container = soup.find("body")
            if container:
                md = _extract_md(container)
                if len(md) > 50:
                    if _is_restricted(md):
                        print(f"🔒 {law_id}: службового використання — фіксуємо як ДСК")
                        return "__RESTRICTED__"
                    return md
                else:
                    print(f"⚠️  {law_id}: /print знайдено контейнер але текст замалий ({len(md)} симв.)")
    except Exception as e:
        print(f"⚠️  get_law_text /print ({law_id}): {e}")

    # ── Спроба 2: звичайна сторінка ──────────────────────────────────────────
    url = f"{BASE}/laws/show/{law_id}#Text"
    try:
        r = httpx.get(url, headers=HEADERS, timeout=20.0, follow_redirects=True)
        if r.status_code != 200:
            return ""

        soup = BeautifulSoup(r.text, "html.parser")
        container = _find_container(soup)
        if not container:
            print(f"⚠️  {law_id}: контейнер не знайдено на жодній сторінці")
            return ""

        md = _extract_md(container)
        if len(md) > 50:
            if _is_restricted(md):
                print(f"🔒 {law_id}: службового використання — фіксуємо як ДСК")
                return "__RESTRICTED__"
            return md

        print(f"⚠️  {law_id}: текст знайдено але замалий ({len(md)} симв.) — пропускаємо")
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
