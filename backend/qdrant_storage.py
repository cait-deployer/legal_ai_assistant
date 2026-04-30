"""
Qdrant storage — мульти-колекційна архітектура.
Кожна правова галузь має окрему колекцію замість однієї ukrainian_laws.
"""
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, VectorParams, PointStruct,
    Filter, FieldCondition, MatchValue, MatchText,
    PayloadSchemaType,
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
ALL_COLLECTIONS: list[str] = RADA_COLLECTIONS + ["laws_supreme", "laws_wiki", "laws_ccu", "laws_positions", "laws_kmu"]

# ── V2 колекції (gemini-embedding-001, 3072 dims) ──────────────────────────────
RADA_V2_COLLECTIONS: list[str] = [f"{c}_v2" for c in RADA_COLLECTIONS]

OTHER_V2_COLLECTIONS: list[str] = [
    "laws_supreme_v2",
    "laws_wiki_v2",
    "laws_ccu_v2",
    "laws_positions_v2",
    "laws_kmu_v2",
    "laws_mod_v2",
    "laws_zir_v2",
]

ALL_V2_COLLECTIONS: list[str] = RADA_V2_COLLECTIONS + OTHER_V2_COLLECTIONS

CATEGORY_TO_V2_COLLECTION: dict[str, str] = {
    k: f"{v}_v2" for k, v in CATEGORY_TO_COLLECTION.items()
}

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


def get_v2_collection_for_category(category_code: str) -> str:
    """Повертає назву v2-колекції для РАДА-категорії. Fallback → rada_other_v2."""
    return CATEGORY_TO_V2_COLLECTION.get(category_code, "rada_other_v2")


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


def init_v2_collections(vector_size: int = 3072, force_recreate: bool = False) -> None:
    """Створює всі _v2 колекції (gemini-embedding-001, 3072 dims) якщо їх немає."""
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}

    for name in ALL_V2_COLLECTIONS:
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
    for _attempt in range(3):
        try:
            get_client().upsert(collection_name=collection_name, points=[point])
            return True
        except Exception as e:
            if _attempt < 2:
                time.sleep(2 ** _attempt)
            else:
                print(f"⚠️  Qdrant upload error [{collection_name}]: {e}")
    return False


# ── ЧИТАННЯ ІСНУЮЧИХ ЗАКОНІВ ───────────────────────────────────────────────────

def get_existing_laws_meta(collection_name: str) -> dict:
    """
    Повертає {law_id: {scraped_at, effective_date}} для однієї колекції.
    Використовує тільки chunk_index=0 щоб не дублювати.
    Пагінує scroll щоб не обмежуватись 10000 документів.
    """
    out: dict = {}
    try:
        client = get_client()
        scroll_filter = Filter(
            must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        )
        offset = None
        while True:
            points, next_offset = client.scroll(
                collection_name=collection_name,
                scroll_filter=scroll_filter,
                with_payload=["law_id", "scraped_at", "effective_date"],
                limit=1000,
                offset=offset,
            )
            for p in points:
                if "law_id" in p.payload:
                    out[p.payload["law_id"]] = {
                        "scraped_at":     p.payload.get("scraped_at", "1970-01-01T00:00:00"),
                        "effective_date": p.payload.get("effective_date", ""),
                        "collection_name": collection_name,
                    }
            if next_offset is None:
                break
            offset = next_offset
    except Exception as e:
        print(f"⚠️  get_existing_laws_meta [{collection_name}]: {e}")
    return out


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
    for _attempt in range(3):
        try:
            get_client().delete(
                collection_name=collection_name,
                points_selector=Filter(
                    must=[FieldCondition(key="law_id", match=MatchValue(value=law_id))]
                ),
            )
            return
        except Exception as e:
            if _attempt < 2:
                time.sleep(2 ** _attempt)
            else:
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
                "_collection":  collection_name,
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


def get_unique_law_count() -> dict | None:
    """
    Повертає кількість унікальних законів (не чанків) у кожній колекції
    та загальну суму. Рахуємо тільки точки з chunk_index == 0
    (перший чанк кожного закону = рівно 1 на закон).
    Повертає None якщо Qdrant недоступний або виникла помилка.
    """
    try:
        client = get_client()
        first_chunk_filter = Filter(
            must=[FieldCondition(key="chunk_index", match=MatchValue(value=0))]
        )
        per_collection: dict[str, int] = {}
        any_success = False
        for name in ALL_COLLECTIONS:
            try:
                result = client.count(
                    collection_name=name,
                    count_filter=first_chunk_filter,
                    exact=True,
                )
                per_collection[name] = result.count or 0
                any_success = True
            except Exception as e:
                print(f"⚠️ law_count [{name}]: {e}")
                per_collection[name] = 0

        if not any_success:
            return None

        return {
            "total": sum(per_collection.values()),
            "per_collection": per_collection,
        }
    except Exception as e:
        print(f"⚠️ get_unique_law_count failed: {e}")
        return None


# ── FULL-TEXT INDEX (keyword fallback) ────────────────────────────────────────

def ensure_text_indexes() -> dict[str, str]:
    """
    Створює full-text індекс по полях 'content' і 'source' для всіх колекцій.
    Qdrant будує індекс у фоні — не блокує роботу системи.
    Повертає {collection: "ready"|"building"|"error"}.
    """
    client = get_client()
    status: dict[str, str] = {}
    for name in ALL_COLLECTIONS:
        try:
            info = client.get_collection(name)
            schema = info.payload_schema or {}
            if "content" in schema:
                status[name] = "ready"
                continue
            client.create_payload_index(
                collection_name=name,
                field_name="content",
                field_schema=PayloadSchemaType.TEXT,
            )
            # Також індексуємо source (заголовок документу) для title-based boost
            try:
                client.create_payload_index(
                    collection_name=name,
                    field_name="source",
                    field_schema=PayloadSchemaType.TEXT,
                )
            except Exception:
                pass
            status[name] = "building"
            print(f"🔍 Text index створюється для '{name}'...")
        except Exception as e:
            status[name] = "error"
            print(f"⚠️ ensure_text_indexes [{name}]: {e}")
    return status


def get_text_index_status() -> dict[str, str]:
    """Повертає статус full-text індексу для кожної колекції."""
    client = get_client()
    result: dict[str, str] = {}
    for name in ALL_COLLECTIONS:
        try:
            info = client.get_collection(name)
            schema = info.payload_schema or {}
            result[name] = "ready" if "content" in schema else "building"
        except Exception:
            result[name] = "error"
    return result


def search_qdrant_text(query: str, collections: list, limit: int = 5) -> list:
    """
    Keyword-пошук по full-text індексу (fallback коли vector score низький).
    Повертає результати з фіксованим similarity=0.45 щоб потрапляли після vector-результатів.
    """
    import re as _re
    client = get_client()
    results: list = []
    # Беремо лише змістовні слова (> 4 символів, без знаків пунктуації)
    words = [_re.sub(r'[^\w]', '', w) for w in query.split()]
    words = [w for w in words if len(w) > 4]
    numbers = [w for w in query.split() if _re.match(r'^\d+$', w)]
    key_terms = list(dict.fromkeys(words[:6] + numbers[:3]))
    if not key_terms:
        return []

    for col in collections:
        try:
            col_limit = limit * 3 if "kmu" in col else limit
            # Шукаємо кожне ключове слово окремо (OR логіка) — MatchText шукає точний збіг
            _seen_ids: set = set()
            for term in key_terms[:4]:  # топ-4 терміни
                try:
                    pts, _ = client.scroll(
                        collection_name=col,
                        scroll_filter=Filter(
                            must=[FieldCondition(key="content", match=MatchText(text=term))]
                        ),
                        limit=col_limit,
                        with_payload=True,
                        with_vectors=False,
                    )
                    for p in pts:
                        if p.id not in _seen_ids:
                            _seen_ids.add(p.id)
                            results.append({
                                "out_content":  p.payload.get("content", ""),
                                "out_metadata": {k: v for k, v in p.payload.items() if k != "content"},
                                "similarity":   0.45,
                                "_collection":  col,
                                "_keyword_match": True,
                            })
                except Exception:
                    pass
        except Exception as e:
            print(f"⚠️ search_qdrant_text [{col}]: {e}")
    return results


def search_qdrant_by_title(keywords: list[str], collections: list, chunks_per_doc: int = 3) -> list:
    """
    Multi-field keyword boost: знаходить документи де source АБО content містить
    ключові слова запиту. Docs ranked by total keyword matches across both fields.
    """
    client = get_client()
    results: list = []

    for col in collections:
        law_match_counts: dict[str, int] = {}
        law_points: dict[str, dict[str, object]] = {}

        for kw in keywords:
            if len(kw) < 5:
                continue
            try:
                # Пагінація — збираємо всі унікальні law_ids, не обмежуємось 500 чанками
                offset = None
                seen_in_kw: set[str] = set()
                while True:
                    pts, next_offset = client.scroll(
                        collection_name=col,
                        scroll_filter=Filter(
                            must=[FieldCondition(key="source", match=MatchText(text=kw))]
                        ),
                        limit=500,
                        offset=offset,
                        with_payload=True,
                        with_vectors=False,
                    )
                    for p in pts:
                        lid = p.payload.get("law_id", "")
                        if not lid:
                            continue
                        if lid not in law_match_counts:
                            law_match_counts[lid] = 0
                            law_points[lid] = {}
                        if lid not in seen_in_kw:
                            law_match_counts[lid] += 1
                            seen_in_kw.add(lid)
                        law_points[lid][str(p.id)] = p
                    if not next_offset or len(law_match_counts) > 500:
                        break
                    offset = next_offset
            except Exception as e:
                print(f"⚠️ search_qdrant_by_title [{col}]: {e}")

        # Sort docs by keyword match count desc → more relevant titles first
        for lid in sorted(law_match_counts, key=lambda l: -law_match_counts[l]):
            pts_list = list(law_points[lid].values())
            pts_list.sort(key=lambda p: p.payload.get("chunk_index", 0))
            for p in pts_list[:chunks_per_doc]:
                results.append({
                    "out_content":  p.payload.get("content", ""),
                    "out_metadata": {k: v for k, v in p.payload.items() if k != "content"},
                    "similarity":   0.71,
                    "_collection":  col,
                    "_title_match": True,
                })

    return results
