"""
Тест: порівняння chunk_size i embedding моделей.

SDK:
  text-embedding-004       -> vertexai.language_models.TextEmbeddingModel (старий)
  gemini-embedding-001     -> google.genai.Client (новий, batch=1 на Vertex AI)
  gemini-embedding-2-preview -> google.genai.Client (новий, batch=1)

Запуск: python test_chunk.py
Потрібно для нових моделей: pip install google-genai
"""

import os, sys, math, time

# ── Налаштування ──────────────────────────────────────────────────────────────
TEST_LAWS = [
    ("2011-12", "Закон про відпустки"),
    ("322-08",  "КЗпП"),
]
QUERY        = "скільки днів щорічної відпустки має звичайний працівник"
TARGET_PHRASE = "24 календарн"

CHUNK_SIZES  = [1000, 1500, 2000, 3000]
CHUNK_OVERLAP = 150

MODELS = [
    {"name": "text-embedding-004",         "sdk": "old", "dims": 768},
    {"name": "gemini-embedding-001",        "sdk": "new", "dims": 3072},
    {"name": "gemini-embedding-2-preview",  "sdk": "new", "dims": 3072},
]

# ── Ініціалізація ─────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))

from langchain_text_splitters import MarkdownTextSplitter
from rada_scanner import get_law_text

try:
    from settings_cache import settings_cache
    _project  = settings_cache.get("vertex_project", "") or os.getenv("VERTEX_PROJECT", "urai-492512")
    _location = settings_cache.get("vertex_location", "us-central1") or "us-central1"
except Exception:
    _project  = os.getenv("VERTEX_PROJECT", "urai-492512")
    _location = os.getenv("VERTEX_LOCATION", "us-central1")

print(f"Vertex AI project={_project}  location={_location}")

# Старий SDK
import vertexai
from vertexai.language_models import TextEmbeddingModel, TextEmbeddingInput
vertexai.init(project=_project, location=_location)

# Новий SDK
try:
    from google import genai
    from google.genai.types import EmbedContentConfig
    _genai_client = genai.Client(vertexai=True, project=_project, location=_location)
    _new_sdk_ok = True
    print("google-genai SDK: OK")
except ImportError:
    _new_sdk_ok = False
    print("⚠  google-genai не встановлено — pip install google-genai")
    print("   Нові моделі будуть пропущені.")


# ── Embedding функції ─────────────────────────────────────────────────────────

def _embed_old(texts: list[str], task: str) -> list[list[float]]:
    """text-embedding-004, batch=5."""
    model  = TextEmbeddingModel.from_pretrained("text-embedding-004")
    result = []
    for i in range(0, len(texts), 5):
        batch = [TextEmbeddingInput(t, task) for t in texts[i:i+5]]
        try:
            result.extend(e.values for e in model.get_embeddings(batch))
        except Exception as ex:
            print(f"\n    ⚠ old-sdk batch {i}: {ex}")
            result.extend([[0.0] * 768] * len(batch))
        time.sleep(0.3)
    return result


def _embed_new(model_name: str, texts: list[str], task: str, dims: int) -> list[list[float]]:
    """gemini-embedding-001 / gemini-embedding-2-preview, batch=1 на Vertex AI."""
    result = []
    cfg_kwargs = {"output_dimensionality": dims}
    # gemini-embedding-2-preview не приймає task_type через enum
    if "preview" not in model_name:
        cfg_kwargs["task_type"] = task
    cfg = EmbedContentConfig(**cfg_kwargs)

    for i, text in enumerate(texts):
        try:
            resp = _genai_client.models.embed_content(
                model=model_name,
                contents=text,
                config=cfg,
            )
            result.append(list(resp.embeddings[0].values))
        except Exception as ex:
            print(f"\n    ⚠ new-sdk [{model_name}] #{i}: {ex}")
            result.append([0.0] * dims)
        if i % 20 == 19:
            time.sleep(1.0)   # throttle кожні 20 запитів
        else:
            time.sleep(0.15)
    return result


def embed(model_cfg: dict, texts: list[str], task: str) -> list[list[float]] | None:
    if model_cfg["sdk"] == "old":
        return _embed_old(texts, task)
    if not _new_sdk_ok:
        return None
    return _embed_new(model_cfg["name"], texts, task, model_cfg["dims"])


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb + 1e-10)


def find_targets(chunks: list[str], phrase: str) -> list[int]:
    pl = phrase.lower()
    return [i for i, c in enumerate(chunks) if pl in c.lower()]


# ── Основний тест ─────────────────────────────────────────────────────────────
print("\n" + "=" * 70)
print(f"ЗАПИТ:  «{QUERY}»")
print(f"ШУКАЄМО: «{TARGET_PHRASE}» в топ-3")
print("=" * 70)

for law_id, law_name in TEST_LAWS:
    print(f"\n{'─'*60}")
    print(f"ЗАКОН: {law_name}  ({law_id})")
    print(f"{'─'*60}")

    text = get_law_text(law_id)
    if not text or text == "__RESTRICTED__":
        print("  ✗ Не вдалося завантажити")
        continue
    print(f"  Довжина тексту: {len(text):,} символів")

    # Діагностика наявності цільової фрази в сирому тексті
    idx = text.lower().find(TARGET_PHRASE.lower())
    if idx == -1:
        print(f"  ⚠ «{TARGET_PHRASE}» НЕ знайдено в сирому тексті!")
        for probe in ["двадцять чотири", "щорічна відпустка", "основна відпустка"]:
            pi = text.lower().find(probe)
            if pi != -1:
                print(f"  ℹ Знайдено «{probe}»: …{text[pi:pi+100]}…")
                break
    else:
        snippet = text[max(0, idx-60):idx+100].replace("\n", " ")
        print(f"  ✓ «{TARGET_PHRASE}» знайдено: …{snippet}…")

    for chunk_size in CHUNK_SIZES:
        splitter = MarkdownTextSplitter(chunk_size=chunk_size, chunk_overlap=CHUNK_OVERLAP)
        chunks   = splitter.split_text(text)
        targets  = find_targets(chunks, TARGET_PHRASE)

        print(f"\n  ── CHUNK_SIZE={chunk_size}  ({len(chunks)} чанків) ──")
        if not targets:
            print(f"    ✗ «{TARGET_PHRASE}» не знайдено в жодному чанку")
            continue
        print(f"    Цільові чанки: {targets}")

        for model_cfg in MODELS:
            mname = model_cfg["name"]
            print(f"\n    [{mname}]")
            if model_cfg["sdk"] == "new" and not _new_sdk_ok:
                print(f"      ПРОПУЩЕНО (немає google-genai)")
                continue

            print(f"      Ембедимо {len(chunks)} чанків...", end=" ", flush=True)
            t0 = time.time()
            chunk_vecs = embed(model_cfg, chunks, "RETRIEVAL_DOCUMENT")
            if chunk_vecs is None:
                print("ПОМИЛКА")
                continue
            query_vec = embed(model_cfg, [QUERY], "RETRIEVAL_QUERY")
            if query_vec is None:
                print("ПОМИЛКА (query)")
                continue
            query_vec = query_vec[0]
            elapsed = time.time() - t0
            print(f"{elapsed:.1f}s")

            scores   = [(i, cosine(query_vec, v)) for i, v in enumerate(chunk_vecs)]
            scores.sort(key=lambda x: x[1], reverse=True)
            top5     = scores[:5]
            top5_idx = [i for i, _ in top5]

            # Найкращий ранг серед цільових чанків
            best_rank = None
            best_target = None
            for t in targets:
                if t in top5_idx:
                    r = top5_idx.index(t) + 1
                    if best_rank is None or r < best_rank:
                        best_rank, best_target = r, t

            if best_rank and best_rank <= 3:
                status = f"✅  В ТОП-3  rank #{best_rank}"
            elif best_rank:
                status = f"⚠   rank #{best_rank}  (не в топ-3)"
            else:
                full_rank = next((i+1 for i, (idx2, _) in enumerate(scores) if idx2 in targets), "?")
                status = f"❌  НЕ ЗНАЙДЕНО  (rank #{full_rank} з {len(chunks)})"

            print(f"      Результат: {status}")

            # Топ-5 з позначкою цілі
            print(f"      Топ-5 (score | чанк#):")
            for ri, (ci, sc) in enumerate(top5):
                marker  = "★ ЦІЛЬ" if ci in targets else "      "
                preview = chunks[ci].replace("\n", " ")[:80]
                print(f"        #{ri+1} {marker}  [{ci}] {sc:.4f}  «{preview}…»")

print("\n" + "=" * 70)
print("ТЕСТ ЗАВЕРШЕНО")
print("=" * 70)
