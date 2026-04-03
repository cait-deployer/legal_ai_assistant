import os
import pandas as pd
import httpx
import time
import io
from datetime import datetime, timezone
from rada_to_supabase import embeddings

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")


def upload_template_to_supabase(title: str, description: str, file_url: str,
                                  category: str, source_dataset_id: str, vector: list) -> bool:
    """Записує шаблон у таблицю document_templates."""
    try:
        with httpx.Client() as client:
            r = client.post(
                f"{SUPABASE_URL}/rest/v1/document_templates",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal",
                },
                json={
                    "title": title,
                    "description": description,
                    "file_url": file_url,
                    "category": category,
                    "source_dataset_id": source_dataset_id,
                    "embedding": vector,
                },
                timeout=10.0,
            )
            r.raise_for_status()
            return True
    except Exception as e:
        print(f"❌ Помилка запису шаблону '{title}': {e}")
        return False


def get_existing_template_urls() -> set:
    """Повертає множину file_url що вже є в базі — щоб не дублювати."""
    try:
        with httpx.Client() as client:
            r = client.get(
                f"{SUPABASE_URL}/rest/v1/document_templates",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                params={"select": "file_url", "limit": "10000"},
                timeout=10.0,
            )
            if r.status_code == 200:
                return {row["file_url"] for row in r.json() if row.get("file_url")}
    except Exception as e:
        print(f"⚠️ Не вдалося отримати існуючі шаблони: {e}")
    return set()


def sync_templates_from_opendata(csv_url: str, category: str = "Офіційні шаблони",
                                   dataset_id: str = "", limit: int = None,
                                   log_callback=None):
    """Завантажує CSV з data.gov.ua і пише шаблони в document_templates."""
    def log(msg):
        print(msg)
        if log_callback:
            log_callback(msg)

    log(f"🚀 Початок імпорту шаблонів з data.gov.ua...")

    try:
        r = httpx.get(csv_url, headers=HEADERS, timeout=30)
        r.raise_for_status()

        df = pd.read_csv(io.StringIO(r.text), sep=None, engine="python")
        total_rows = len(df)
        log(f"📊 Знайдено {total_rows} записів у файлі.")

        existing_urls = get_existing_template_urls()
        log(f"📋 Вже в базі: {len(existing_urls)} шаблонів")

        processed = 0
        skipped = 0

        for _, row in df.iterrows():
            if limit and processed >= limit:
                break

            # Гнучкий пошук колонок (назви можуть відрізнятись у різних датасетах)
            title = str(
                row.get("назва_послуги") or row.get("назва") or
                row.get("title") or row.get("name") or ""
            ).strip()

            file_url = str(
                row.get("посилання_на_файл") or row.get("url") or
                row.get("link") or row.get("file_url") or ""
            ).strip()

            if not title or not file_url or "http" not in file_url:
                continue

            if file_url in existing_urls:
                skipped += 1
                continue

            # Опис для embedding — що буде шукатись при запиті користувача
            description = (
                f"Офіційний шаблон документа: {title}. "
                f"Категорія: {category}. "
                f"Джерело: Державний портал відкритих даних України."
            )

            try:
                vector = embeddings.embed_query(description)
                ok = upload_template_to_supabase(
                    title=title,
                    description=description,
                    file_url=file_url,
                    category=category,
                    source_dataset_id=dataset_id,
                    vector=vector,
                )
                if ok:
                    existing_urls.add(file_url)
                    processed += 1
                    log(f"  ✅ {title[:60]}")
                time.sleep(0.3)
            except Exception as e:
                log(f"  ❌ Помилка '{title}': {e}")

        log(f"🏁 Імпорт завершено. Додано: {processed}, пропущено (дублі): {skipped}.")
        return processed

    except Exception as e:
        log(f"💥 Критична помилка: {e}")
        return 0


DOCUMENT_EXTENSIONS = {".doc", ".docx", ".pdf", ".odt", ".rtf", ".xls", ".xlsx"}
SEARCH_QUERIES = ["шаблон", "зразок", "бланк", "заява"]
CKAN_SEARCH_URL = "https://data.gov.ua/api/3/action/package_search"


def get_all_template_csv_urls() -> list[dict]:
    """Шукає на порталі data.gov.ua всі CSV з посиланнями на шаблони документів."""
    seen_urls: set = set()
    results: list[dict] = []

    with httpx.Client(headers=HEADERS, timeout=20.0) as client:
        for query in SEARCH_QUERIES:
            try:
                resp = client.get(CKAN_SEARCH_URL, params={"q": query, "rows": 100})
                resp.raise_for_status()
                datasets = resp.json().get("result", {}).get("results", [])
            except Exception as e:
                print(f"⚠️ Пошук '{query}' не вдався: {e}")
                continue

            for ds in datasets:
                ds_id = ds.get("name", "")
                for res in ds.get("resources", []):
                    if res.get("format", "").lower() != "csv":
                        continue
                    url = (res.get("url") or "").strip()
                    if not url or url in seen_urls:
                        continue
                    seen_urls.add(url)
                    results.append({"url": url, "dataset_id": ds_id})

    return results


if __name__ == "__main__":
    import sys
    dry_run = "--dry-run" in sys.argv

    print("🔎 Шукаємо CSV-джерела на data.gov.ua...")
    all_csvs = get_all_template_csv_urls()
    print(f"📦 Знайдено {len(all_csvs)} потенційних CSV-джерел.\n")

    if dry_run:
        for item in all_csvs:
            print(f"  [{item['dataset_id']}] {item['url']}")
        print("\n✅ Dry-run завершено. Запусти без --dry-run щоб імпортувати.")
    else:
        total = 0
        for item in all_csvs:
            count = sync_templates_from_opendata(
                csv_url=item["url"],
                dataset_id=item["dataset_id"],
                category="Офіційні шаблони",
            )
            total += count
        print(f"\n🎉 Всього додано шаблонів: {total}")