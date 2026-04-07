import os
from google.genai import Client
from dotenv import load_dotenv

load_dotenv()
client = Client(api_key=os.getenv("NEXT_PUBLIC_GOOGLE_API_KEY"))

print("=== СПИСОК ДОСТУПНЫХ МОДЕЛЕЙ ===")
print("-" * 50)

# Просто выводим всё, что возвращает Google
for m in client.models.list():
    # Выводим имя и возможности (capabilities)
    print(f"Модель: {m.name}")
    print(f"Возможности: {m.supported_actions}")
    print("-" * 50)