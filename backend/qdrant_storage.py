"""
Qdrant storage — мульти-колекційна архітектура.
Кожна правова галузь має окрему колекцію замість однієї ukrainian_laws.
"""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue,
)

QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")

# ── МАППІНГ: РАДА-код → колекція ──────────────────────────────────────────────
CATEGORY_TO_COLLECTION: dict[str, str] = {
    # Фінанси, банки, податки
    "h2":  "rada_finance",   # Банки, фінанси, кредит, бюджет
    "h3":  "rada_finance",   # Бухоблік, оподаткування, аудит
    "h26": "rada_finance",   # Цінні папери, фондовий ринок
    "h23": "rada_finance",   # Митна діяльність, ЗЕД
    # Держустрій (окрема — 25K+ документів)
    "h4":  "rada_state",     # Держустрій, громадянство, паспорти
    # Кадри та нагородження (окрема — 24K+ документів)
    "h27": "rada_personnel", # Кадрові питання, нагородження
    # Суд та правосуддя
    "h22": "rada_court",     # Суд, прокуратура, юстиція
    "h30": "rada_court",     # Судова практика
    "h1":  "rada_court",     # Господарсько-процесуальне
    # Міжнародне
    "h11": "rada_intl",      # Міжнародні відносини
    # Трудове та соціальне
    "h19": "rada_labor",     # Трудові відносини, зайнятість
    "h20": "rada_labor",     # Соціальне забезпечення, страхування
    # Цивільне та сімейне
    "h5":  "rada_civil",     # Цивільне та цивільно-процесуальне
    "h16": "rada_civil",     # Охорона здоров'я, сім'я, молодь
    "h13": "rada_civil",     # Нотаріат, адвокатура
    # Кримінальне
    "h25": "rada_criminal",  # Кримінальне та кримінально-процесуальне
    # Адміністративне
    "h8":  "rada_admin",     # Адміністративна відповідальність
    "h10": "rada_admin",     # Ліцензування, сертифікація
    "h31": "rada_admin",     # Загальні засади регулювання економіки
    # Житлове та будівництво
    "h6":  "rada_housing",   # Житлове, ЖКГ
    "h21": "rada_housing",   # Будівництво, архітектура
    # Земельне та сільське господарство
    "h9":  "rada_land",      # Природні ресурси, земля
    "h18": "rada_land",      # Сільське господарство
    # Промисловість та бізнес
    "h7":  "rada_industry",  # Транспорт, зв'язок, інформація
    "h17": "rada_industry",  # Промисловість, енергетика
    "h15": "rada_industry",  # Підприємства, інвестиції
    # Інше
    "h12": "rada_other",     # Наука, освіта, культура
    "h14": "rada_other",     # Охорона, безпека, ЗСУ
    "h24": "rada_other",     # Торгівля, громадське харчування
    "h28": "rada_other",     # Регіональне законодавство
    "h29": "rada_other",     # Проекти, внесення змін до НПА
    "h32": "rada_other",     # Ядерне, Чорнобиль
}

# Всі РАДА-колекції
RADA_COLLECTIONS: list[str] = [
    "rada_finance",
    "rada_state",
    "rada_personnel",
    "rada_court",
    "rada_intl",
    "rada_labor",
    "rada_civil",
    "rada_criminal",
    "rada_admin",
    "rada_housing",
    "rada_land",
    "rada_industry",
    "rada_other",
]

# Всі колекції системи
ALL_COLLECTIONS: list[str] = RADA_COLLECTIONS + ["laws_supreme", "laws_wiki"]

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        if "localhost" in QDRANT_URL or "127.0.0.1" in QDRANT_URL:
            _client = QdrantClient(url=QDRANT_URL, timeout=30)
        else:
            _client = QdrantClient(url=QDRANT_URL, prefix="qdrant", timeout=30)
    return _client


def get_collection_for_category(category_code: str) -> str:
    """Повертає назву колекції для РАДА-категорії. Fallback → rada_other."""
    return CATEGORY_TO_COLLECTION.get(category_code, "rada_other")


# ── ІНІЦІАЛІЗАЦІЯ ──────────────────────────────────────────────────────────────

def init_all_collections(vector_size: int = 768, force_recreate: bool = False) -> None:
    """Створює всі колекції системи якщо їх немає."""
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}

    for name in ALL_COLLECTIONS:
        if name in existing:
            if not force_recreate:
                print(f"✅ '{name}' вже існує — пропускаємо.")
                continue
            client.delete_collection(name)
            print(f"🗑️  Видалено '{name}'.")

        client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        print(f"✅ Колекцію '{name}' створено (size={vector_size}).")


def drop_old_collection(name: str = "ukrainian_laws") -> None:
    """Видаляє стару єдину колекцію. Викликати вручну після міграції."""
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    if name in existing:
        client.delete_collection(name)
        print(f"🗑️  Стару колекцію '{name}' видалено.")
    else:
        print(f"ℹ️  Колекція '{name}' не знайдена — нічого видаляти.")


# ── ЗАПИС ─────────────────────────────────────────────────────────────────────

def upload_to_qdrant(
    text: str,
    metadata: dict,
    embedding: list,
    collection_name: str,
    session_id: str | None = None,
) -> None:
    """Зберігає один чанк у вказану колекцію."""
    payload = {**metadata, "content": text, "law_domain": collection_name}
    if session_id:
        payload["sync_session_id"] = session_id

    point = PointStruct(id=str(uuid.uuid4()), vector=embedding, payload=payload)
    try:
        get_client().upsert(collection_name=collection_name, points=[point])
    except Exception as e:
        print(f"⚠️  Qdrant upload error [{collection_name}]: {e}")


# ── ЧИТАННЯ ІСНУЮЧИХ ЗАКОНІВ ───────────────────────────────────────────────────

def get_existing_laws_meta(collection_name: str) -> dict:
    """
    Повертає {law_id: {scraped_at, effective_date}} для однієї колекції.
    Використовує тільки chunk_index=0 щоб не дублювати.
    """
    try:
        result, _ = get_client().scroll(
            collection_name=collection_name,
            scroll_filter=Filter(
                must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
            ),
            with_payload=["law_id", "scraped_at", "effective_date"],
            limit=10000,
        )
        return {
            p.payload["law_id"]: {
                "scraped_at":     p.payload.get("scraped_at", "1970-01-01T00:00:00"),
                "effective_date": p.payload.get("effective_date", ""),
                "collection_name": collection_name,
            }
            for p in result if "law_id" in p.payload
        }
    except Exception as e:
        print(f"⚠️  get_existing_laws_meta [{collection_name}]: {e}")
        return {}


def get_all_existing_laws_meta() -> dict:
    """
    Повертає {law_id: {scraped_at, effective_date, collection_name}} по всіх колекціях.
    Запити паралельні — ThreadPoolExecutor.
    """
    all_meta: dict = {}

    def _fetch(col: str) -> dict:
        return get_existing_laws_meta(col)

    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(_fetch, col): col for col in ALL_COLLECTIONS}
        for future in as_completed(futures):
            try:
                all_meta.update(future.result())
            except Exception as e:
                print(f"⚠️  get_all_existing_laws_meta: {e}")

    return all_meta


def get_existing_law_ids() -> set:
    """Повертає set всіх law_id у всіх колекціях."""
    return set(get_all_existing_laws_meta().keys())


# ── ВИДАЛЕННЯ ─────────────────────────────────────────────────────────────────

def delete_law_chunks(law_id: str, collection_name: str) -> None:
    """Видаляє всі чанки закону з вказаної колекції."""
    try:
        get_client().delete(
            collection_name=collection_name,
            points_selector=Filter(
                must=[FieldCondition(key="law_id", match=MatchValue(value=law_id))]
            ),
        )
        print(f"🗑️  Видалено '{law_id}' з '{collection_name}'.")
    except Exception as e:
        print(f"❌ delete_law_chunks [{collection_name}]: {e}")


# ── ПОШУК ─────────────────────────────────────────────────────────────────────

def _search_single(collection_name: str, query_vector: list, top_k: int, threshold: float) -> list:
    """Пошук в одній колекції. Внутрішня функція."""
    client = get_client()
    try:
        if hasattr(client, "query_points"):
            response = client.query_points(
                collection_name=collection_name,
                query=query_vector,
                limit=top_k,
                score_threshold=threshold,
                with_payload=True,
            )
            points = response.points
        else:
            points = client.search(
                collection_name=collection_name,
                query_vector=query_vector,
                limit=top_k,
                score_threshold=threshold,
                with_payload=True,
            )
        return [
            {
                "out_content":  r.payload.get("content", ""),
                "out_metadata": {k: v for k, v in r.payload.items() if k != "content"},
                "similarity":   r.score,
            }
            for r in points
        ]
    except Exception as e:
        print(f"❌ search [{collection_name}]: {e}")
        return []


def search_qdrant(
    query_vector: list,
    top_k: int = 10,
    collections: list | None = None,
    match_threshold: float = 0.4,
) -> list:
    """
    Паралельний пошук по вказаних колекціях (або всіх якщо None).
    Повертає merged + sorted за score результати, обрізані до top_k.
    """
    targets = collections or ALL_COLLECTIONS
    all_results: list = []

    with ThreadPoolExecutor(max_workers=min(len(targets), 8)) as ex:
        futures = [
            ex.submit(_search_single, col, query_vector, top_k, match_threshold)
            for col in targets
        ]
        for f in as_completed(futures):
            try:
                all_results.extend(f.result())
            except Exception as e:
                print(f"⚠️  search future: {e}")

    all_results.sort(key=lambda x: x["similarity"], reverse=True)
    return all_results[:top_k]


# ── СТАТИСТИКА ─────────────────────────────────────────────────────────────────

def get_collection_stats() -> dict:
    """Повертає {collection_name: points_count} для всіх колекцій."""
    client = get_client()
    stats: dict = {}
    for name in ALL_COLLECTIONS:
        try:
            info = client.get_collection(name)
            stats[name] = info.points_count or 0
        except Exception:
            stats[name] = 0
    return stats


def get_total_doc_count() -> int:
    """Загальна кількість векторів у всіх колекціях."""
    return sum(get_collection_stats().values())
