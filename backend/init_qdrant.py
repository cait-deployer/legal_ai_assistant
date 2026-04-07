import os
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from dotenv import load_dotenv

load_dotenv()

client = QdrantClient(url="https://n-ai01.nexchance.de", prefix="qdrant", timeout=30)

COLLECTION_NAME = "ukrainian_laws"

def init_legal_vault():
    print(f"📡 Перевірка зв'язку з Qdrant на n-ai01.nexchance.de...")
    
    # Видаляємо стару колекцію, якщо хочемо почати "з чистого листа" 
    # (Обережно: це видалить всі дані в цій колекції!)
    # client.delete_collection(collection_name=COLLECTION_NAME)

    # Створюємо колекцію зі структурою під Gemini (768 розмір вектора)
    client.recreate_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=768,        # Розмірність для Google Gemini Embeddings
            distance=Distance.COSINE  # Найкраще для текстової схожості
        ),
    )
    
    print(f"✅ Колекція '{COLLECTION_NAME}' створена!")
    print(f"📝 Структура Payload адаптована під ваш Supabase.")

if __name__ == "__main__":
    init_legal_vault()