"""
Реіндексує КМУ 98-2011: таблицю країн конвертує в натуральну мову.

| Польща | 61 | 120 | → "Польща: добові 61, проживання до 120"

Це покращує якість ембедингів для запитів типу
"скільки добових до США" / "добові Польща відрядження".
"""
import re
import embed_v2
import json
from qdrant_storage import upload_to_qdrant, delete_law_chunks
from langchain_text_splitters import MarkdownTextSplitter
from datetime import datetime, timezone

FILE_ID = "kmu_98-2011-%D0%BF"
STORED_ID = FILE_ID
LAW_URL = "https://zakon.rada.gov.ua/laws/show/98-2011-%D0%BF"
COUNTRIES_PER_CHUNK = 15  # менше країн = більш конкретний чанк

with open(f"/root/laws_raw/kmu/{FILE_ID}.txt", encoding="utf-8") as f:
    raw = f.read()

try:
    with open(f"/root/laws_raw/kmu/{FILE_ID}.meta.json", encoding="utf-8") as f:
        meta = json.load(f)
except Exception:
    meta = {}

title = meta.get("title") or "Про суми та склад витрат на відрядження державних службовців"
print(f"Title: {title[:80]}")

TABLE_PREFIX = (
    "Норми добових витрат та граничних сум відшкодування витрат на найм "
    "житлового приміщення для закордонних відряджень державних службовців "
    "(Постанова КМУ №98 від 02.02.2011, Додаток 1). "
    "Суми вказані у валюті країни відрядження або доларах США.\n\n"
)

TABLE_ROW_RE = re.compile(r"^\|\s*.+\|\s*\d+")
HEADER_RE = re.compile(r"^\|\s*(Країна|Country|Держава|Найменування)", re.IGNORECASE)


def parse_table_row(line):
    """Повертає (country, daily, hotel) або None якщо рядок не є рядком даних."""
    parts = [p.strip() for p in line.strip().strip("|").split("|")]
    if len(parts) < 2:
        return None
    # Перша колонка — назва країни (не число)
    country = parts[0].strip()
    if not country or country.replace("-", "").replace(" ", "").isdigit():
        return None
    # Шукаємо числа серед решти колонок
    numbers = []
    for p in parts[1:]:
        p = p.strip()
        if re.match(r"^\d+([.,]\d+)?$", p):
            numbers.append(p)
    if not numbers:
        return None
    daily = numbers[0] if len(numbers) > 0 else "—"
    hotel = numbers[1] if len(numbers) > 1 else "—"
    return country, daily, hotel


def row_to_natural(country, daily, hotel):
    return (
        f"{country}: добові {daily}, проживання до {hotel} на добу."
    )


# Розбиваємо файл на регуляторний текст і таблицю
lines = raw.splitlines()
table_rows = []
reg_lines = []

in_table = False
for line in lines:
    if TABLE_ROW_RE.match(line):
        in_table = True
        table_rows.append(line)
    elif in_table and line.strip().startswith("|"):
        table_rows.append(line)
    else:
        if not in_table:
            reg_lines.append(line)

reg_text = "\n".join(reg_lines)
print(f"Regulatory text lines: {len(reg_lines)}, Table rows: {len(table_rows)}")

# --- Регуляторні чанки ---
reg_chunks = MarkdownTextSplitter(chunk_size=3000, chunk_overlap=300).split_text(reg_text)
reg_prefixed = [title + "\n\n" + c for c in reg_chunks]
print(f"Regulatory chunks: {len(reg_chunks)}")

# --- Таблиця: конвертуємо в натуральну мову ---
natural_rows = []
skipped = 0
for line in table_rows:
    parsed = parse_table_row(line)
    if parsed:
        country, daily, hotel = parsed
        natural_rows.append(row_to_natural(country, daily, hotel))
    else:
        skipped += 1

print(f"Natural rows: {len(natural_rows)}, skipped (headers/separators): {skipped}")

# Групуємо по COUNTRIES_PER_CHUNK
table_chunks = []
for i in range(0, len(natural_rows), COUNTRIES_PER_CHUNK):
    group = "\n".join(natural_rows[i: i + COUNTRIES_PER_CHUNK])
    table_chunks.append(TABLE_PREFIX + group)

print(f"Table chunks: {len(table_chunks)}")
if table_chunks:
    print("First table chunk preview:")
    print(table_chunks[0][:400])

all_chunks = reg_prefixed + table_chunks
print(f"\nTotal chunks: {len(all_chunks)}")

# --- Embed ---
vectors = embed_v2.embed_documents(all_chunks, task="RETRIEVAL_DOCUMENT")
print(f"Embedded: {len(vectors)}")

# --- Видалити старі, завантажити нові ---
delete_law_chunks(STORED_ID, collection_name="laws_kmu_v2")
print("Deleted old chunks")

now = datetime.now(timezone.utc).isoformat()
ok = 0
for i, (ct, v) in enumerate(zip(all_chunks, vectors)):
    if v:
        is_table = i >= len(reg_prefixed)
        result = upload_to_qdrant(
            ct,
            {
                "source": title,
                "law_id": STORED_ID,
                "doc_type": "Постанова КМУ",
                "category": "Постанова КМУ",
                "law_url": LAW_URL,
                "source_domain": "zakon.rada.gov.ua",
                "is_table": is_table,
                "scraped_at": now,
                "chunk_index": i,
            },
            v,
            collection_name="laws_kmu_v2",
        )
        if result:
            ok += 1
            chunk_type = "table" if is_table else "text"
            if is_table:
                print(f"  chunk {i} [{chunk_type}]: ok")
        else:
            print(f"  chunk {i}: FAILED")

print(f"\nDone! Uploaded {ok}/{len(all_chunks)} chunks")
