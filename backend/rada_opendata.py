"""
URAI — Повний Field Audit Ради OpenData API.
Мета: протестувати ~8 різних документів, вивести ВСІ поля з розшифровкою,
      зрозуміти що беремо в метадані.

Запуск: PYTHONIOENCODING=utf-8 python rada_opendata.py
"""
import json
import requests
import time

HEADERS = {"User-Agent": "OpenData"}
BASE    = "https://data.rada.gov.ua"
CSV_BASE = f"{BASE}/ogd/zak/laws/data/csv"

# STATUS_MAP та DEAD_STATUSES завантажуються з stan.txt нижче

# ── Завантажуємо довідники один раз ───────────────────────────────────────────
def load_csv(name: str, encoding="cp1251") -> dict[str, str]:
    url = f"{CSV_BASE}/{name}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return {}
        result = {}
        for line in r.content.decode(encoding, errors="replace").splitlines():
            parts = line.split("\t", 1)
            if len(parts) == 2:
                result[parts[0].strip()] = parts[1].strip()
        return result
    except Exception:
        return {}

def load_csv3(name: str, encoding="cp1251") -> dict[str, tuple[str, str]]:
    """Завантажити CSV з 3 колонками: id -> (forward_name, reverse_name)."""
    url = f"{CSV_BASE}/{name}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return {}
        result = {}
        for line in r.content.decode(encoding, errors="replace").splitlines():
            parts = line.split("\t")
            if len(parts) >= 3:
                result[parts[0].strip()] = (parts[1].strip(), parts[2].strip())
            elif len(parts) == 2:
                result[parts[0].strip()] = (parts[1].strip(), parts[1].strip())
        return result
    except Exception:
        return {}


print("Завантажуємо довідники...")
TYP_MAP      = load_csv("typ.txt")
PODIA_MAP    = load_csv("podia.txt")
VIDNOSH_RAW  = load_csv3("vidnosh.txt")   # id -> (forward, reverse)
VIDNOSH_MAP  = {k: v[0] for k, v in VIDNOSH_RAW.items()}
ORG_MAP      = load_csv("org.txt")
ORGNAME_MAP  = load_csv("orgname.txt")    # orgid -> повна назва + скорочення
KLAS_MAP     = load_csv("klasname.txt")   # classifier id -> назва класу
TEMY_MAP     = load_csv("temy.txt")       # tema id -> назва теми (32 теми)
TAGS_MAP     = load_csv("tags.txt")       # tags id -> ознака документа (35 ознак)
STAN_MAP_RAW = load_csv("stan.txt")
print(f"  typ={len(TYP_MAP)} | podia={len(PODIA_MAP)} | vidnosh={len(VIDNOSH_RAW)} | org={len(ORG_MAP)}")
print(f"  klasname={len(KLAS_MAP)} | temy={len(TEMY_MAP)} | tags={len(TAGS_MAP)} | orgname={len(ORGNAME_MAP)} | stan={len(STAN_MAP_RAW)}")

# STATUS_MAP: {int -> str}
STATUS_MAP = {int(k): v for k, v in STAN_MAP_RAW.items() if k.isdigit()}
print(f"\n  STAN_MAP (status codes):")
for code, name in sorted(STATUS_MAP.items()):
    print(f"    status={code} -> {name}")

# DEAD_STATUSES: статуси що означають документ не чинний
DEAD_KEYWORDS = ("втратив", "зупинено", "не застосовується", "крім окремих")
DEAD_STATUSES = {code for code, name in STATUS_MAP.items()
                 if any(kw in name.lower() for kw in DEAD_KEYWORDS)}
print(f"\n  DEAD_STATUSES = {DEAD_STATUSES}")

# Показуємо всі події щоб знати реальні podid
print("\n  PODIA_MAP (всі events):")
for pid, name in sorted(PODIA_MAP.items(), key=lambda x: int(x[0]) if x[0].isdigit() else 999):
    print(f"    podid={pid:>3} -> {name}")

# Визначаємо podid що означають "документ помер"
# Заповнюємо автоматично за ключовими словами в назві
PODIA_DEAD_IDS = {
    int(pid)
    for pid, name in PODIA_MAP.items()
    if pid.isdigit() and any(kw in name.lower() for kw in ("втрат", "зупинен", "скасован", "припинен"))
}
print(f"\n  PODIA_DEAD_IDS (death events): {PODIA_DEAD_IDS}")


# ── API виклики ────────────────────────────────────────────────────────────────
def get_card(nreg: str) -> dict | None:
    url = f"{BASE}/laws/card/{nreg}.json"
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        if r.status_code == 200:
            d = r.json()
            if "nazva" in d:
                return d
    except Exception as e:
        print(f"  ERROR get_card({nreg}): {e}")
    return None


# ── Декодери ───────────────────────────────────────────────────────────────────
def fmt_date(d) -> str:
    s = str(d)
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    return s or "—"


def decode_hist(hist: list) -> list[dict]:
    out = []
    for h in hist:
        pid  = str(h.get("podid", ""))
        date = fmt_date(h.get("poddat", ""))
        name = PODIA_MAP.get(pid, f"подія_{pid}")
        out.append({"date": date, "event": name, "podid": int(pid) if pid.isdigit() else -1})
    return out


# Перевіряємо реальні назви подій з PODIA_MAP (виводиться при старті)
PODIA_DEAD_IDS: set[int] = set()   # заповнюємо нижче після завантаження довідника


def find_dead_date(hist_decoded: list, is_dead: bool) -> str:
    """
    Дата втрати чинності — ТІЛЬКИ якщо документ справді мертвий (status in DEAD_STATUSES).
    Шукаємо podid=3 (Втрата чинності) або podid=2 (Зупинення дії).
    НЕ plутаємо з podid=1 (Набрання чинності)!
    """
    if not is_dead:
        return ""
    for h in hist_decoded:
        if h["podid"] in PODIA_DEAD_IDS:
            return h["date"]
    # Fallback: остання подія в hist якщо явної "втрати" немає
    return hist_decoded[-1]["date"] if hist_decoded else ""


def decode_links(links_str: str) -> list[dict]:
    if not links_str:
        return []
    result = []
    for part in links_str.split("##"):
        part = part.strip()
        if not part:
            continue
        segs = part.split("#")
        if len(segs) < 2:
            continue
        dokid = segs[0].strip()
        # перший тип зв'язку (може бути кілька через |)
        first_type = segs[1].split(":")[0].split("|")[0].strip()
        if dokid.isdigit():
            result.append({
                "dokid":    dokid,
                "rel_code": first_type,
                "rel_name": VIDNOSH_MAP.get(first_type, f"тип_{first_type}"),
            })
    return result



# ── Основний аудит документа ───────────────────────────────────────────────────
def audit(nreg: str, description: str = ""):
    sep = "=" * 70
    print(f"\n{sep}")
    print(f"  ДОКУМЕНТ: {nreg}" + (f"  [{description}]" if description else ""))
    print(sep)

    card = get_card(nreg)
    if not card:
        print("  !! Не вдалося отримати картку (404 або помилка)")
        return

    # ── Розшифровані значення ──
    status_code = card.get("status", -1)
    typ_code    = str(card.get("typ", ""))
    orgid       = str(card.get("orgid", card.get("org", "")))
    typ_name    = TYP_MAP.get(typ_code, f"тип_{typ_code}")
    org_name    = ORG_MAP.get(orgid, f"орган_{orgid}")
    is_dead     = status_code in DEAD_STATUSES

    hist_dec    = decode_hist(card.get("hist", []))
    links_dec   = decode_links(card.get("links", ""))
    dead_since  = find_dead_date(hist_dec, is_dead)

    # editions — eds[0] = ОСТАННЯ редакція
    eds = card.get("eds", [])
    last_ed = eds[0] if eds else {}
    # replaced_by = nreg замінника ТІЛЬКИ якщо документ мертвий
    # для чинних документів pidstava = остання поправка, не замінник!
    replaced_by = (last_ed.get("pidstava", "") or card.get("pidstava", "")) if is_dead else ""

    print(f"\n  -- ІДЕНТИФІКАТОРИ --")
    print(f"  nreg       : {card.get('nreg', '—')}")
    print(f"  dokid      : {card.get('dokid', '—')}")
    print(f"  n_vlas     : {card.get('n_vlas', '—')}   (власний номер органу)")
    print(f"  minjust    : {card.get('minjust', '—') or '(немає реєстрації МЮ)'}")

    print(f"\n  -- СТАТУС ТА ТИП --")
    print(f"  status     : [{status_code}] {STATUS_MAP.get(status_code, '?')}  {'!! МЕРТВИЙ' if is_dead else ('~ невизначено' if status_code == 0 else 'OK')}")
    print(f"  typ        : [{typ_code}] {typ_name}")
    print(f"  org        : [{orgid}] {org_name}")

    print(f"\n  -- ДАТИ --")
    print(f"  pridat     : {fmt_date(card.get('pridat', ''))}   (дата прийняття / реєстрації)")
    print(f"  datred     : {fmt_date(card.get('datred', ''))}   (остання редакція)")
    print(f"  orgdat     : {fmt_date(card.get('orgdat', ''))}   (дата від органу)")
    print(f"  poddat     : {fmt_date(card.get('poddat', ''))}   (дата останньої події)")

    last_amendment = last_ed.get("pidstava", "") or card.get("pidstava", "")

    print(f"\n  -- РЕДАКЦІЇ --")
    print(f"  edcnt      : {card.get('edcnt', 0)}  (кількість редакцій)")
    print(f"  comped     : {card.get('comped', '—')}  (поточна скомп. редакція)")
    print(f"  last_amendment : {last_amendment or '—'}  (nreg останньої поправки)")
    if is_dead:
        if replaced_by:
            print(f"  *** ЗАМІНЕНО ЗАКОНОМ: {replaced_by} ***")
        if dead_since:
            print(f"  *** МЕРТВИЙ З: {dead_since} ***")
    else:
        if last_amendment:
            print(f"  (останню поправку вніс: {last_amendment})")

    print(f"\n  -- ПУБЛІКАЦІЯ --")
    publics = card.get("publics", "")
    if publics:
        for pub in publics.split("|"):
            parts = pub.split(":", 2)
            if len(parts) >= 2:
                print(f"  publics    : {fmt_date(parts[0])} вид.{parts[1]}  {parts[2] if len(parts)>2 else ''}")
    else:
        print(f"  publics    : (немає)")

    # --- Декодування класифікації ---
    # klasy: pipe-separated classifier IDs  e.g. '43|171'  (can be int for single-class docs)
    klasy_raw  = str(card.get("klasy", "") or "")
    klasy_dec  = " | ".join(KLAS_MAP.get(k, f"?{k}") for k in klasy_raw.split("|") if k) if klasy_raw else "—"

    # temy: theme ID(s), pipe-separated  e.g. 5 or "2|20"
    temy_id    = str(card.get("temy", "") or "")
    if temy_id and "|" in temy_id:
        temy_dec = " | ".join(TEMY_MAP.get(t, f"?{t}") for t in temy_id.split("|") if t)
    else:
        temy_dec = TEMY_MAP.get(temy_id, f"?{temy_id}") if temy_id else "—"

    # tags: single tag ID (or None)  e.g. 1 -> "Первинні акти..."
    tags_raw   = card.get("tags", None)
    tags_str   = str(tags_raw) if tags_raw is not None else ""
    tags_dec   = TAGS_MAP.get(tags_str, f"тег_{tags_str}") if tags_str else "—"
    has_no_text = tags_raw == 4  # tag=4 = "Текст відсутній" -> не індексуємо!

    # types: pipe-separated ALL type IDs  e.g. '21|1|124'
    types_raw  = str(card.get("types", "") or "")
    types_dec  = " | ".join(TYP_MAP.get(t, f"?{t}") for t in types_raw.split("|") if t) if types_raw else "—"

    print(f"\n  -- КЛАСИФІКАЦІЯ --")
    print(f"  klasy      : {klasy_raw or '—'}  ->  {klasy_dec}")
    print(f"  temy       : [{temy_id}] {temy_dec}")
    print(f"  tags       : [{tags_str or '—'}] {tags_dec}" + ("  !! БЕЗ ТЕКСТУ — ПРОПУСТИТИ" if has_no_text else ""))
    print(f"  types      : {types_raw or '—'}  ->  {types_dec}")
    print(f"  termcnt    : {card.get('termcnt', 0)}  (юр. терміни)")

    print(f"\n  -- РОЗМІР --")
    print(f"  pages      : {card.get('pages', '—')}  сторінок")
    print(f"  size       : {card.get('size', '—')}  байт")
    print(f"  format     : {card.get('format', '—')}  (1=doc, 2=html)")

    print(f"\n  -- АНОТАЦІЇ --")
    anots = card.get("anots", [])
    if anots:
        for a in anots[:2]:
            print(f"  anot       : [{a.get('ann_lang','?')}] {a.get('ann_nam','')[:80]}")
    else:
        print(f"  anots      : (немає)")

    print(f"\n  -- ПАРЛАМЕНТСЬКІ ДАНІ (тільки для законів ВР) --")
    print(f"  komitet    : {card.get('komitet', '—')}  (профільний комітет)")
    projs = card.get("projs", [])
    if projs:
        p = projs[0]
        print(f"  projs[0]   : #{p.get('proj_num','')} від {p.get('proj_dat','')} — {p.get('proj_nam','')[:60]}")
    perv = card.get("perv", "")
    if perv:
        print(f"  perv       : {perv}  (первинна редакція?)")

    print(f"\n  -- ПІДПИСАНТИ --")
    sig = card.get("sig", [])
    if sig:
        for s in sig[:3]:
            print(f"  sig        : id={s.get('id')} name={s.get('name','?')} date={s.get('date','?')}")
    else:
        print(f"  sig        : (немає підписів)")

    print(f"\n  -- ПОВІ'ЯЗАНІ --")
    pere = card.get("pere", [])
    print(f"  pere       : {pere[:5] if pere else '(немає)'}")

    print(f"\n  -- ЗОВНІШНІ ЗВ'ЯЗКИ (links поле) --")
    raw_links = card.get("links", "")
    print(f"  links raw  : {raw_links[:120] or '(немає)'}")
    if links_dec:
        for lnk in links_dec[:5]:
            print(f"  link       : dokid={lnk['dokid']}  [{lnk['rel_code']}] {lnk['rel_name']}")
        if len(links_dec) > 5:
            print(f"             ... і ще {len(links_dec)-5}")
    else:
        print(f"  links      : (немає)")

    print(f"\n  -- ПОВНА ІСТОРІЯ ПОДІЙ --")
    for h in hist_dec[:10]:
        if h["podid"] in PODIA_DEAD_IDS:
            marker = "!! DEAD "
        elif h["podid"] == 4:
            marker = "++ ПРИЙН"
        elif h["podid"] == 1:
            marker = "~~ НАБРАН"  # Набрання чинності (не смерть!)
        else:
            marker = "        "
        print(f"  {marker}  {h['date']}  {h['event']}")
    if len(hist_dec) > 10:
        print(f"  ... і ще {len(hist_dec)-10} подій")

    print(f"\n  ={'='*58}")
    print(f"  ВИСНОВОК ДЛЯ QDRANT METADATA:")
    meta = {
        "rada_status":        status_code,
        "rada_is_dead":       is_dead,
        "rada_no_text":       has_no_text,           # tag=4 -> пропустити при індексуванні
        "rada_doc_type":      typ_name,
        "rada_org":           org_name,
        "rada_adopted_date":  fmt_date(card.get("pridat", "")),
        "rada_last_edition":  fmt_date(card.get("datred", "")),
        "rada_replaced_by":   replaced_by or None,
        "rada_dead_since":    dead_since or None,
        "rada_minjust":       card.get("minjust", "") or None,
        "rada_theme":         temy_dec if temy_id else None,  # розшифрована тема
        "rada_classifiers":   klasy_dec if klasy_raw else None,  # розшифровані класифікатори
        "rada_editions_cnt":  card.get("edcnt", 0),
    }
    for k, v in meta.items():
        print(f"  {k:<25} = {v}")


# ── ТЕСТ-КЕЙСИ ────────────────────────────────────────────────────────────────
# Охоплюємо різні: статуси, типи, органи, наявність minjust
TEST_CASES = [
    # (nreg,           опис)
    ("v9834500-05",  "Лист НБУ 2005, status=0 — хвора сіра зона"),
    ("663-99-п",     "КМУ Постанова 1999, status=1 — МЕРТВИЙ, є замінник"),
    ("98-2011-п",    "КМУ Постанова 2011 — ТОЙ САМИЙ замінник 663-99-п"),
    ("435-15",       "Цивільний кодекс, status=5, 182 редакції"),
    ("2341-14",      "Кримінальний кодекс, status=5"),
    ("z0119-94",     "Наказ з minjust реєстрацією (z-prefix)"),
    ("80731-10",     "Земельний кодекс? — тестуємо"),
    ("1057-15",      "? — невідомий, перевіряємо що повертає"),
]

if __name__ == "__main__":
    for nreg, desc in TEST_CASES:
        audit(nreg, desc)
        time.sleep(0.8)

    print(f"\n\n{'='*70}")
    print("  ПІДСУМОК: які поля ЗАВЖДИ є vs інколи")
    print("="*70)
    print("""
  ЗАВЖДИ:
    nreg, dokid, status, typ, orgid, datred, pridat, nazva, hist

  ІНКОЛИ (залежить від типу):
    minjust     — тільки для підзаконних актів зареєстрованих МЮ
    komitet     — тільки для законів ВР
    projs       — тільки для законів ВР
    anots       — тільки для великих кодексів (рідко)
    perv        — тільки для чинних законів ВР
    pidstava    — є коли є підстава для редакції/скасування
    replaced_by — є тільки якщо документ мав редакції по підставі
    sig         — підписи (рідко повні дані)

  КЛЮЧОВІ ПОЛЯ ДЛЯ МЕТАДАНИХ:
    1. status + is_dead         -> фільтрація мертвих
    2. pridat                   -> вік документа (краще ніж datred)
    3. datred                   -> коли востаннє оновлювали
    4. typ (typ_name)           -> тип: Лист vs Постанова vs Кодекс
    5. orgid (org_name)         -> орган: КМУ vs НБУ vs ВРУ
    6. pidstava / replaced_by   -> яким законом замінено (ланцюг!)
    7. dead_since               -> коли помер (з hist podid=3)
    8. minjust                  -> чи зареєстровано в МЮ
    9. klasy                    -> класифікатори тем
    10. edcnt                   -> кількість редакцій (популярність закону)
    """)
