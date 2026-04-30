"""
Реіндексує КМУ 98-2011 з покращеними таблиця-чанками.

Стратегія:
- Регуляторний текст (правила розрахунку) → великі чанки (3000), стандартний prefix
- Таблиця країн (| Країна | добові | проживання |) → малі чанки (20 країн кожен),
  prefix з явним описом "Норми добових витрат для закордонних відряджень"
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
COUNTRIES_PER_CHUNK = 20

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
    "(Постанова КМУ №98 від 02.02.2011, Додаток 1):\n\n"
)

# Розбиваємо файл на регуляторний текст і таблицю
lines = raw.splitlines()
table_rows = []
reg_lines = []
TABLE_ROW_RE = re.compile(r"^\|\s*.+\|\s*\d+")

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

# --- Регуляторні чанки (як раніше) ---
reg_chunks = MarkdownTextSplitter(chunk_size=3000, chunk_overlap=300).split_text(reg_text)
reg_prefixed = [title + "\n\n" + c for c in reg_chunks]
print(f"Regulatory chunks: {len(reg_chunks)}")

# --- Таблиця: групуємо по COUNTRIES_PER_CHUNK рядків ---
table_chunks = []
for i in range(0, len(table_rows), COUNTRIES_PER_CHUNK):
    group = "\n".join(table_rows[i : i + COUNTRIES_PER_CHUNK])
    table_chunks.append(TABLE_PREFIX + group)

print(f"Table chunks: {len(table_chunks)}")

all_chunks = reg_prefixed + table_chunks
print(f"Total chunks: {len(all_chunks)}")

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
            print(f"  chunk {i} [{chunk_type}]: ok")
        else:
            print(f"  chunk {i}: FAILED")

print(f"\nDone! Uploaded {ok}/{len(all_chunks)} chunks")
