
from google.genai import Client
from dotenv import load_dotenv
import os

load_dotenv()
client = Client(api_key=os.environ.get("GOOGLE_API_KEY"))

print("=== Модели с поддержкой embedContent ===")
for m in client.models.list():
    if "embed" in m.name.lower() or "embedding" in m.name.lower():
        print(m.name)