import os
import traceback
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google.genai import Client, types
from langchain_google_genai import GoogleGenerativeAIEmbeddings

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

gemini = Client(api_key=GOOGLE_API_KEY)

# Используем стабильную модель для эмбеддингов
embeddings = GoogleGenerativeAIEmbeddings(
    model="models/gemini-embedding-001",
    google_api_key=GOOGLE_API_KEY
)

class Query(BaseModel):
    question: str

def search_supabase(query_vector: list, top_k: int = 10) -> list:
    """Векторный поиск через RPC функцию match_documents"""
    try:
        with httpx.Client() as client:
            response = client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/match_documents",
                headers={
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "query_embedding": query_vector, # httpx сам поймет список чисел
                    "match_threshold": 0.5,
                    "match_count": top_k
                },
                timeout=10.0
            )
            if response.status_code != 200:
                print(f"❌ Supabase search error: {response.text}")
                return []
            return response.json()
    except Exception as e:
        print(f"❌ Connection error: {str(e)}")
        return []

@app.post("/ask")
async def ask_lawyer(data: Query):
    print(f"🔍 ПОИСК: {data.question}")
    try:
        # 1. Генерируем вектор вопроса
        query_vector = embeddings.embed_query(data.question)

        # 2. Ищем в базе (теперь получаем поля out_id, out_content, out_metadata)
        docs = search_supabase(query_vector, top_k=10)
        
        if not docs:
            return {"answer": "В моей базе знаний пока нет информации по этому вопросу.", "references": []}

        # 3. Собираем контекст (используем новые ключи out_content и out_metadata)
        context_parts = []
        for i, d in enumerate(docs):
            content = d.get("out_content", "")
            source = d.get("out_metadata", {}).get("source", "Документ")
            context_parts.append(f"[{i+1}] Источник: {source}\nТекст: {content}")
        
        context = "\n\n---\n\n".join(context_parts)

        # 4. Формируем промпт для Gemini
        prompt = f"""Ты - профессиональный юрист. Ответь на вопрос, используя ТОЛЬКО предоставленный контекст.
Обязательно ставь номер источника [1], [2] в конце каждого факта.

КОНТЕКСТ:
{context}

ВОПРОС: {data.question}"""

        response = gemini.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=types.Content(role="user", parts=[types.Part.from_text(text=prompt)])
        )

        # 5. Формируем ссылки для фронтенда (сопоставляем с out_metadata)
        seen_sources = {}
        references = []
        for i, d in enumerate(docs):
            content_snippet = d.get("out_content") or d.get("content") or ""
            metadata = d.get("out_metadata") or d.get("metadata") or {}
            source_name = metadata.get("source", "Документ")
            
            # Каждый чанк из базы получает свой порядковый номер [1], [2], [3]...
            references.append({
                "num": i + 1,
                "source_title": f"{source_name} (фрагмент {i+1})",
                "passages": [content_snippet]
            })

        print(f"✅ Готово. Сформировано ссылок: {len(references)}")
        return {"answer": response.text, "references": references}

    except Exception as e:
        traceback.print_exc()
        return {"answer": f"Системная ошибка: {str(e)}", "references": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
