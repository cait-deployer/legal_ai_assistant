import asyncio
import os
import tempfile
import csv
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from notebooklm import NotebookLMClient
from notebooklm.rpc import ReportFormat

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _get_first_notebook(client):
    notebooks = await client.notebooks.list()
    if not notebooks:
        raise Exception("No notebooks found in this account.")
    return notebooks[0]


@app.get("/")
async def home():
    return {"status": "NotebookLM Backend is Online"}


@app.post("/ask")
async def ask_lawyer(data: dict):
    question = data.get("question")
    print(f"\n[🚀] NEW REQUEST: {question}")
    try:
        print("[🔑] Connecting to NotebookLM storage...")
        async with await NotebookLMClient.from_storage() as client:
            print("[📚] Fetching your notebooks...")
            nb = await _get_first_notebook(client)
            print(f"[📂] Using notebook: '{nb.title}' (ID: {nb.id})")
            print("[🧠] AI is thinking... Please wait (15-40 sec)")
            result = await client.chat.ask(nb.id, question)
            print(f"[✅] Answer received! {len(result.references)} citations found.")

            # Map source UUIDs to human-readable titles
            sources = await client.sources.list(nb.id)
            source_titles = {s.id: (s.title or f"Source {s.id[:8]}") for s in sources}

            # Group all passages by citation number (one [N] can reference multiple chunks)
            refs_by_num: dict[int, dict] = {}
            for ref in result.references:
                num = ref.citation_number
                if num is None: continue
                
                # Берем текст. Если есть расширенный контекст - берем его
                text = (ref.cited_text or "").strip()
                
                if num not in refs_by_num:
                    refs_by_num[num] = {
                        "num": num,
                        "source_title": source_titles.get(ref.source_id, f"Source {num}"),
                        "passages": [],
                    }
                
                # Добавляем текст, только если он уникальный и длиннее 10 символов
                if text and len(text) > 10 and text not in refs_by_num[num]["passages"]:
                    refs_by_num[num]["passages"].append(text)

            # Сортируем и отдаем
            references = sorted(refs_by_num.values(), key=lambda r: r["num"])

            return {"answer": result.answer, "references": references}
    except Exception as e:
        print(f"[🔥] CRITICAL ERROR: {str(e)}")
        return {"answer": f"Backend Error: {str(e)}", "references": []}


@app.post("/risk-report")
async def risk_report():
    print("\n[📊] RISK REPORT generation started")
    try:
        async with await NotebookLMClient.from_storage() as client:
            nb = await _get_first_notebook(client)
            print(f"[📂] Notebook: '{nb.title}'")

            status = await client.artifacts.generate_report(
                nb.id,
                report_format=ReportFormat.CUSTOM,
                custom_prompt=(
                    "You are a senior legal analyst. Analyze the provided document and produce "
                    "a structured Legal Risk Report. Use the following sections:\n\n"
                    "## Executive Summary\n"
                    "Brief overview of the document and the most critical risks.\n\n"
                    "## Key Legal Risks\n"
                    "List each risk with severity label (🔴 HIGH / 🟡 MEDIUM / 🟢 LOW), "
                    "description, and impact.\n\n"
                    "## Problematic Clauses\n"
                    "Quote or reference specific clauses that require attention.\n\n"
                    "## Recommended Actions\n"
                    "Actionable steps to mitigate each identified risk."
                ),
            )
            print(f"[⏳] Waiting for generation (task_id: {status.task_id})...")
            final = await client.artifacts.wait_for_completion(nb.id, status.task_id, timeout=120)

            if final.is_failed:
                return {"error": f"Generation failed: {final.error}"}

            tmp = tempfile.NamedTemporaryFile(suffix=".md", delete=False)
            tmp_path = tmp.name
            tmp.close()

            try:
                path = await client.artifacts.download_report(nb.id, tmp_path, artifact_id=status.task_id)
                with open(path, encoding="utf-8") as f:
                    content = f.read()
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

            print("[✅] Risk report ready!")
            return {"type": "markdown", "content": content}
    except Exception as e:
        print(f"[🔥] ERROR: {str(e)}")
        return {"error": str(e)}


@app.post("/data-table")
async def data_table():
    print("\n[📋] DATA TABLE generation started")
    try:
        async with await NotebookLMClient.from_storage() as client:
            nb = await _get_first_notebook(client)
            print(f"[📂] Notebook: '{nb.title}'")

            status = await client.artifacts.generate_data_table(
                nb.id,
                instructions=(
                    "Extract all key legal entities: parties involved, dates, monetary amounts, "
                    "obligations, rights, deadlines, and relevant clause references into a table."
                ),
            )
            print(f"[⏳] Waiting for generation (task_id: {status.task_id})...")
            final = await client.artifacts.wait_for_completion(nb.id, status.task_id, timeout=120)

            if final.is_failed:
                return {"error": f"Generation failed: {final.error}"}

            tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
            tmp_path = tmp.name
            tmp.close()

            try:
                path = await client.artifacts.download_data_table(nb.id, tmp_path, artifact_id=status.task_id)
                with open(path, encoding="utf-8", newline="") as f:
                    reader = csv.DictReader(f)
                    headers = list(reader.fieldnames or [])
                    rows = [dict(row) for row in reader]
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

            print(f"[✅] Data table ready! {len(rows)} rows, {len(headers)} columns.")
            return {"type": "table", "headers": headers, "rows": rows}
    except Exception as e:
        print(f"[🔥] ERROR: {str(e)}")
        return {"error": str(e)}


@app.post("/audio-overview")
async def audio_overview():
    print("\n[🎧] AUDIO OVERVIEW generation started")
    try:
        async with await NotebookLMClient.from_storage() as client:
            nb = await _get_first_notebook(client)
            print(f"[📂] Notebook: '{nb.title}'")

            status = await client.artifacts.generate_audio(nb.id)
            print(f"[⏳] Waiting for audio (task_id: {status.task_id}) — up to 3 min...")
            final = await client.artifacts.wait_for_completion(nb.id, status.task_id, timeout=180)

            if final.is_failed:
                return {"error": f"Generation failed: {final.error}"}

            url = final.url
            if not url:
                artifact = await client.artifacts.get(nb.id, status.task_id)
                url = artifact.url if artifact else None

            print(f"[✅] Audio ready! URL: {url}")
            return {"type": "audio", "url": url, "task_id": status.task_id}
    except Exception as e:
        print(f"[🔥] ERROR: {str(e)}")
        return {"error": str(e)}


@app.post("/mind-map")
async def mind_map():
    print("\n[🗺️] MIND MAP generation started")
    try:
        async with await NotebookLMClient.from_storage() as client:
            nb = await _get_first_notebook(client)
            print(f"[📂] Notebook: '{nb.title}'")

            result = await client.artifacts.generate_mind_map(nb.id)
            mind_map_data = result.get("mind_map")

            if mind_map_data is None:
                return {"error": "Mind map generation returned no data."}

            print("[✅] Mind map ready!")
            return {"type": "mindmap", "data": mind_map_data}
    except Exception as e:
        print(f"[🔥] ERROR: {str(e)}")
        return {"error": str(e)}

# Запуск: uvicorn server:app --reload
