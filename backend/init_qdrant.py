"""
Ініціалізація Qdrant колекції на сервері.
Запускати ОДИН РАЗ на сервері: python init_qdrant.py
"""
from qdrant_storage import init_collection

if __name__ == "__main__":
    print("📡 Підключаємось до Qdrant на n-ai01.nexchance.de...")
    init_collection(vector_size=768, force_recreate=False)
    print("🏁 Готово!")
