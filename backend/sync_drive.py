import os
import traceback
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google.genai import Client, types # Добавили types для жесткой структуры
from dotenv import load_dotenv

# 1. Загружаем настройки
load_dotenv()
api_key = os.getenv("NEXT_PUBLIC_GOOGLE_API_KEY")

if not api_key:
    print("❌ КРИТИЧЕСКАЯ ОШИБКА: GOOGLE_API_KEY не найден в .env!")

client = Client(api_key=api_key)
app = FastAPI()

# Настройки доступа (CORS) для фронтенда
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class Query(BaseModel):
    question: str

@app.get("/")
async def home():
    return {"status": "Gemini Lawyer Engine is Online"}

@app.post("/ask")
async def ask_lawyer(data: Query):
    print(f"🚀 ЗАПРОС ПОЛУЧЕН! Вопрос: {data.question}")
    try:
        # 1. Собираем список активных файлов из облака
        print("📁 Обращаюсь к Gemini Cloud за списком файлов...")
        active_files = []
        for f in client.files.list():
            if f.state.name == "ACTIVE":
                active_files.append(f)

        if not active_files:
            print("📭 Файлов не найдено.")
            return {"answer": "Ваша библиотека пуста. Запустите sync_drive.py", "references": []}

        # 2. ФОРМИРУЕМ СТРОГИЙ КОНТЕНТ (Решение проблемы 26 ошибок)
        prompt_text = f"""
        Ты - профессиональный юрист. Ответь на вопрос клиента, используя ТОЛЬКО предоставленные документы.
        
        ПРАВИЛА:
        1. Обязательно ставь номер источника в скобках в конце фактов, например [1] или [2].
        2. Если информации нет в файлах, так и скажи.
        3. Пиши на языке вопроса клиента.
        
        ВОПРОС: {data.question}
        """

        # Создаем части сообщения: текст инструкции + ссылки на файлы
        message_parts = [types.Part.from_text(text=prompt_text)]
        
        for f in active_files:
            message_parts.append(
                types.Part.from_uri(
                    file_uri=f.uri,
                    mime_type=f.mime_type
                )
            )

        print(f"📚 Найдено документов: {len(active_files)}. Отправляю в Gemini...")

        # 3. Генерация ответа через официальный объект Content
        response = client.models.generate_content(
            model="gemini-1.5-flash",
            contents=types.Content(role="user", parts=message_parts)
        )
        
        # 4. Собираем ссылки для фронтенда
        references = []
        for i, f in enumerate(active_files):
            references.append({
                "num": i + 1,
                "source_title": f.display_name or f.name.split('/')[-1],
                "passages": ["Документ проанализирован для ответа."]
            })
        
        print("✅ Ответ получен от AI.")
        return {
            "answer": response.text,
            "references": references
        }
    
    except Exception as e:
        print("❌ ОШИБКА В ТЕРМИНАЛЕ:")
        traceback.print_exc()
        return {"answer": f"Backend Error: {str(e)}", "references": []}