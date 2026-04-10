"""
Одноразовий скрипт ініціалізації Qdrant для нової мульти-колекційної архітектури.

Запуск на сервері:
  cd /home/devops/app/backend
  source venv/bin/activate
  python init_collections.py

Що робить:
  1. Створює 15 нових колекцій (якщо ще не існують)
  2. Видаляє стару колекцію ukrainian_laws (якщо є)
  3. Виводить статистику
"""
import os
from dotenv import load_dotenv

load_dotenv()

from qdrant_storage import (
    init_all_collections,
    drop_old_collection,
    get_collection_stats,
    ALL_COLLECTIONS,
)


def main():
    print("=" * 60)
    print("🚀 URAI — Ініціалізація мульти-колекційної архітектури")
    print("=" * 60)
    print(f"Qdrant URL: {os.environ.get('QDRANT_URL', 'http://localhost:6333')}")
    print()

    # Крок 1: Створюємо нові колекції
    print("📦 Крок 1: Створення колекцій...")
    init_all_collections(vector_size=768, force_recreate=False)
    print()

    # Крок 2: Видаляємо стару колекцію
    print("🗑️  Крок 2: Видалення старої колекції ukrainian_laws...")
    drop_old_collection("ukrainian_laws")
    print()

    # Крок 3: Перевіряємо статистику
    print("📊 Крок 3: Статистика колекцій:")
    stats = get_collection_stats()
    total = 0
    for name, count in stats.items():
        status = "✅" if count >= 0 else "❌"
        print(f"  {status} {name:<25} {count:>8} векторів")
        total += count
    print(f"  {'─' * 40}")
    print(f"  {'ВСЬОГО':<25} {total:>8} векторів")
    print()
    print("✅ Готово! Тепер запускай скрапінг через адмінку.")
    print("=" * 60)


if __name__ == "__main__":
    main()
