"""Одноразовий скрипт: реіндексує КМУ 98-2011 в laws_kmu_v2."""
import embed_v2
import json
from qdrant_storage import upload_to_qdrant, delete_law_chunks
from langchain_text_splitters import MarkdownTextSplitter
from datetime import datetime, timezone

FILE_ID = "kmu_98-2011-%D0%BF"
stored_id = FILE_ID

with open(f"/root/laws_raw/kmu/{FILE_ID}.txt", encoding="utf-8") as f:
    text = f.read()

try:
    with open(f"/root/laws_raw/kmu/{FILE_ID}.meta.json", encoding="utf-8") as f:
        meta = json.load(f)
except Exception:
    meta = {}

title = meta.get("title") or FILE_ID
print(f"Title: {title}")

chunks = MarkdownTextSplitter(chunk_size=4000, chunk_overlap=400).split_text(text)
prefixed = [title + "\n\n" + c for c in chunks]
print(f"Chunks: {len(chunks)}")

vectors = embed_v2.embed_documents(prefixed, task="RETRIEVAL_DOCUMENT")
print(f"Vectors: {len(vectors)}")

delete_law_chunks(stored_id, collection_name="laws_kmu_v2")
print("Deleted old chunks")

now = datetime.now(timezone.utc).isoformat()
for i, (ct, v) in enumerate(zip(prefixed, vectors)):
    if v:
        ok = upload_to_qdrant(
            ct,
            {
                "source": title,
                "law_id": stored_id,
                "doc_type": "Постанова КМУ",
                "category": "Постанова КМУ",
                "law_url": "https://zakon.rada.gov.ua/laws/show/98-2011-%D0%BF",
                "source_domain": "zakon.rada.gov.ua",
                "scraped_at": now,
                "chunk_index": i,
            },
            v,
            collection_name="laws_kmu_v2",
        )
        print(f"  chunk {i}: {'ok' if ok else 'FAILED'}")

print("Done!")
