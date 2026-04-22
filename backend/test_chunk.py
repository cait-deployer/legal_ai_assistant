"""
Тест: порівняння chunk_size і embedding моделей.

Перевіряємо:
  - Закон "Про відпустки" (2011-12): чи знаходимо "24 календарних дні"
  - КЗпП (322-08): чи знаходимо статтю про відпустки

Для кожного розміру чанку + для кожної моделі:
  1. Розбиваємо текст
  2. Ембедимо всі чанки
  3. Ембедимо тестовий запит
  4. Шукаємо топ-3 чанки за cosine similarity
  5. Показуємо чи є в топ-3 потрібна відповідь ("24 календарних")

Запуск: python test_chunk.py
"""

import os, sys, math, time

# ── Налаштування ────────────────────────────────────────────────────────────
TEST_LAWS = [
    ("2011-12", "Закон про відпустки"),
    ("322-08",  "КЗпП"),
]
QUERY = "скільки днів щорічної відпустки має звичайний працівник"
TARGET_PHRASE = "24 календарн"   # що шукаємо у відповіді

CHUNK_SIZES  = [1000, 1500, 2000, 3000]
CHUNK_OVERLAP = 150

MODELS = [
    "text-embedding-004",           # поточна
    "gemini-embedding-001",         # GA, 3072 dims
    "gemini-embedding-2-preview",   # Preview, 3072 dims
]

# ── Ініціалізація Vertex AI ──────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))

import vertexai
from vertexai.language_models import TextEmbeddingModel
from langchain_text_splitters import MarkdownTextSplitter
from rada_scanner import get_law_text

# Беремо налаштування з .env або settings_cache
try:
    from settings_cache import settings_cache
    _project = settings_cache.get("vertex_project", "") or os.getenv("VERTEX_PROJECT", "")
    _location = settings_cache.get("vertex_location", "us-central1") or "us-central1"
except Exception:
    _project = os.getenv("VERTEX_PROJECT", "urai-492512")
    _location = os.getenv("VERTEX_LOCATION", "us-central1")

print(f"Vertex AI: project={_project}, location={_location}")
vertexai.init(project=_project, location=_location)


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-10)


def embed_texts(model_name: str, texts: list[str]) -> list[list[float]]:
    """Ембедить список текстів батчами по 5."""
    model  = TextEmbeddingModel.from_pretrained(model_name)
    result = []
    batch  = 5
    for i in range(0, len(texts), batch):
        chunk = texts[i : i + batch]
        try:
            embeddings = model.get_embeddings(chunk)
            result.extend(e.values for e in embeddings)
        except Exception as ex:
            print(f"  ⚠ embed error batch {i}: {ex}")
            result.extend([[0.0] * 768] * len(chunk))
        time.sleep(0.3)   # throttle
    return result


def find_target_chunk(chunks: list[str], phrase: str) -> int | None:
    """Повертає індекс першого чанку що містить phrase."""
    phrase_low = phrase.lower()
    for i, c in enumerate(chunks):
        if phrase_low in c.lower():
            return i
    return None


# ── Основний тест ────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print(f"ЗАПИТ: «{QUERY}»")
print(f"ЦІЛЬ: знайти чанк з «{TARGET_PHRASE}» в топ-3")
print("=" * 70)

for law_id, law_name in TEST_LAWS:
    print(f"\n{'─'*60}")
    print(f"ЗАКОН: {law_name} ({law_id})")
    print(f"{'─'*60}")

    print("Завантажуємо текст...")
    text = get_law_text(law_id)
    if not text or text == "__RESTRICTED__":
        print("  ✗ Не вдалося завантажити")
        continue
    print(f"  Довжина: {len(text):,} символів")

    for chunk_size in CHUNK_SIZES:
        splitter = MarkdownTextSplitter(chunk_size=chunk_size, chunk_overlap=CHUNK_OVERLAP)
        chunks   = splitter.split_text(text)
        target   = find_target_chunk(chunks, TARGET_PHRASE)

        print(f"\n  CHUNK_SIZE={chunk_size}: {len(chunks)} чанків", end="")
        if target is None:
            print(f"  ✗ «{TARGET_PHRASE}» не знайдено в жодному чанку")
            continue
        print(f"  | «{TARGET_PHRASE}» в чанку #{target}")

        for model_name in MODELS:
            print(f"    [{model_name}] ембедимо {len(chunks)} чанків...", end=" ", flush=True)
            t0 = time.time()
            try:
                chunk_vecs = embed_texts(model_name, chunks)
                query_vec  = embed_texts(model_name, [QUERY])[0]
                elapsed    = time.time() - t0
            except Exception as e:
                print(f"ПОМИЛКА: {e}")
                continue

            # Топ-3 за cosine
            scores  = [(i, cosine(query_vec, v)) for i, v in enumerate(chunk_vecs)]
            scores.sort(key=lambda x: x[1], reverse=True)
            top3    = scores[:3]
            top3_idx = [i for i, _ in top3]

            found = target in top3_idx
            rank  = top3_idx.index(target) + 1 if found else None

            status = f"✅ ЗНАЙДЕНО (rank #{rank})" if found else f"❌ НЕ В ТОП-3 (rank #{next((i+1 for i,(idx,_) in enumerate(scores) if idx==target), '?')})"
            print(f"{elapsed:.1f}s → {status}")

            if found:
                print(f"      Чанк #{target} (score={scores[target][1]:.3f}):")
                preview = chunks[target].replace("\n", " ")[:200]
                print(f"      «{preview}…»")

print("\n" + "=" * 70)
print("ТЕСТ ЗАВЕРШЕНО")
print("=" * 70)
