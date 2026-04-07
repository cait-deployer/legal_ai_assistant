import os
from google.genai import Client
from dotenv import load_dotenv

load_dotenv()
client = Client(api_key=os.getenv("NEXT_PUBLIC_GOOGLE_API_KEY"))

print("🧹 Начинаю очистку облака Gemini...")
files = list(client.files.list())
if not files:
    print("✅ Облако уже пустое!")
else:
    for f in files:
        print(f"🗑️ Удаляю: {f.display_name} ({f.name})")
        client.files.delete(name=f.name)
    print("✨ Все файлы удалены. Теперь облако чистое!")