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
AI_MODEL = os.environ.get("AI_MODEL")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

gemini = Client(api_key=GOOGLE_API_KEY)

embeddings = GoogleGenerativeAIEmbeddings(
    model=EMBEDDING_MODEL,
    google_api_key=GOOGLE_API_KEY
)

class Query(BaseModel):
    question: str

def search_supabase(query_vector: list, top_k: int = 10) -> list:
    """Векторний пошук через RPC-функцію match_documents"""
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
                    "query_embedding": query_vector,
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
    print(f"🔍 ПОШУК: {data.question}")
    try:
        # 1. Генеруємо вектор питання
        query_vector = embeddings.embed_query(data.question)

        # 2. Шукаємо в базі
        docs = search_supabase(query_vector, top_k=6)

        if not docs:
            return {
                "answer": "В моїй базі знань поки що немає інформації з цього питання.",
                "references": []
            }

        # 3. Збираємо контекст
        context_parts = []
        for i, d in enumerate(docs):
            content  = d.get("out_content", "")
            metadata = d.get("out_metadata", {})
            source   = metadata.get("source", "Документ")
            context_parts.append(f"[{i+1}] Джерело: {source}\nТекст: {content}")

        context = "\n\n---\n\n".join(context_parts)

        # 4. Формуємо промпт для Gemini
        prompt = f"""Ти — професійний юрист. Відповідай на питання, використовуючи ТІЛЬКИ наданий контекст.
Обов'язково став номер джерела [1], [2] в кінці кожного факту.

КОНТЕКСТ:
{context}

ПИТАННЯ: {data.question}"""

        response = gemini.models.generate_content(
            model=AI_MODEL,
            contents=types.Content(
                role="user",
                parts=[types.Part.from_text(text=prompt)]
            )
        )

        # 5. Формуємо посилання для фронтенду
        # Передаємо status і law_url — фронтенд показує плашку і deep link
        references = []
        for i, d in enumerate(docs):
            # RPC match_documents повертає префікс 'out_'
            content_snippet = d.get("out_content") or ""
            metadata = d.get("out_metadata") or d.get("metadata") or {}

            # Витягуємо дані з JSONB об'єкта
            source_name = metadata.get("source") or metadata.get("source_title") or "Документ"
            status      = metadata.get("status", "Невідомо")
            law_url     = metadata.get("law_url", "")
            law_id      = metadata.get("law_id", "")

            references.append({
                "num":          i + 1,
                "source_title": source_name,
                "status":       status,
                "law_url":      law_url,
                "law_id":       law_id,
                "passages":     [content_snippet]
            })

        print(f"✅ Готово. Сформовано посилань: {len(references)}")
        return {"answer": response.text, "references": references}

    except Exception as e:
        traceback.print_exc()
        return {"answer": f"Системна помилка: {str(e)}", "references": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))