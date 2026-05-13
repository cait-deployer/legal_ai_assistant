"""Small LLM-powered utility routes used by the chat UI.

These routes are registered from server.py to keep the main FastAPI module
focused on orchestration, admin operations and the primary ask pipeline.
"""

from fastapi import HTTPException

from schemas import GenerateNameRequest, GenerateUserPromptRequest, SummarizeHistoryBody


def register_generation_routes(app, settings_cache, logger, is_vertex_initialized, init_vertex_ai) -> None:
    @app.post("/summarize_history")
    async def summarize_history_endpoint(body: SummarizeHistoryBody):
        """Стискає список повідомлень в короткий резюме (200-300 слів).
        Якщо є existing_summary — включає його в новий стислий контекст."""
        if not body.messages:
            return {"summary": body.existing_summary or ""}

        model_name = settings_cache.get("rewrite_model", "gemini-2.5-flash")
        from vertexai.generative_models import GenerativeModel, GenerationConfig
        try:
            from vertexai.generative_models import ThinkingConfig as _SumThinkingConfig
            _sum_gen_cfg = GenerationConfig(
                temperature=0.0, max_output_tokens=4000,
                thinking_config=_SumThinkingConfig(thinking_budget=0),
            )
        except Exception:
            _sum_gen_cfg = GenerationConfig(temperature=0.0, max_output_tokens=4000)

        lines: list[str] = []
        if body.existing_summary:
            lines.append(f"[Попереднє резюме]\n{body.existing_summary}\n")
        for turn in body.messages:
            role = turn.get("role", "")
            content = (turn.get("content") or "").strip()[:800]
            if role == "user":
                lines.append(f"Користувач: {content}")
            elif role == "assistant":
                lines.append(f"Асистент: {content}")

        dialogue_text = "\n".join(lines)
        prompt = (
            "Зроби стислий переказ наступного діалогу між юридичним асистентом і користувачем. "
            "Збережи ключові факти: про що запитував користувач, які закони або норми згадувалися, "
            "які висновки були зроблені, які уточнення вже поставлені та які відповіді вже надані. "
            "Не використовуй markdown-заголовки. Переказ має бути 250-450 слів, українською мовою.\n\n"
            f"{dialogue_text}\n\nСтислий переказ:"
        )

        try:
            import asyncio as _asyncio
            _sum_model = GenerativeModel(model_name)
            resp = await _asyncio.wait_for(
                _asyncio.to_thread(
                    _sum_model.generate_content,
                    prompt,
                    generation_config=_sum_gen_cfg,
                ),
                timeout=20,
            )
            summary = ""
            try:
                summary = (resp.text or "").strip()
            except Exception:
                pass
            if not summary:
                # Fallback: non-thought parts
                try:
                    summary = " ".join(
                        getattr(p, "text", "").strip()
                        for p in resp.candidates[0].content.parts
                        if not getattr(p, "thought", False) and getattr(p, "text", "")
                    ).strip()
                except Exception:
                    pass
            if not summary:
                raise ValueError("empty summary")
            return {"summary": summary}
        except Exception as e:
            logger.warning("summarize_history failed: %s", e)
            fallback = dialogue_text[:4000].strip()
            return {"summary": fallback}


    @app.post("/generate-name")
    async def generate_name(body: GenerateNameRequest):
        """Генерує назву та категорію чату через Vertex AI."""
        import asyncio as _asyncio
        from vertexai.generative_models import GenerativeModel, GenerationConfig
        import vertexai, json as _json

        creds    = settings_cache.get_credentials()
        project  = settings_cache.get_vertex_project()
        location = settings_cache.get_vertex_location()
        model_name = settings_cache.get("ai_model")
        vertexai.init(project=project, location=location, credentials=creds)

        prompt = (
            "Ти — юридичний асистент. Проаналізуй запит користувача та відповідь AI.\n\n"
            "Поверни СТРОГО JSON без жодного іншого тексту:\n"
            '{"title":"назва до 5 слів без лапок","category":"категорія права"}\n\n'
            "Категорії: Трудове, Кримінальне, Цивільне, ФОП/Бізнес, Сімейне, Нерухомість, Мобілізація, Захист прав, Інше\n\n"
            f"Запит: {body.question[:500]}\nВідповідь: {body.answer[:500]}"
        )

        try:
            model = GenerativeModel(model_name)
            response = await _asyncio.to_thread(
                model.generate_content,
                prompt,
                generation_config=GenerationConfig(temperature=0.3, max_output_tokens=60),
            )
            raw = response.text.replace("```json", "").replace("```", "").strip()
            parsed = _json.loads(raw)
            return {
                "title":    (parsed.get("title", "") or "")[:80],
                "category": (parsed.get("category", "") or "")[:50],
            }
        except Exception as e:
            raise HTTPException(500, f"generate-name error: {e}")


    @app.post("/generate-user-prompt")
    async def generate_user_prompt(body: GenerateUserPromptRequest):
        """Генерує персональний AI-промпт на основі профілю юзера з онбордингу."""
        import asyncio as _asyncio
        from vertexai.generative_models import GenerativeModel, GenerationConfig

        role_label = body.role or "не вказано"
        sub_role_label = ", ".join(body.sub_role) if body.sub_role else "не вказано"
        segment_label = ", ".join(body.segment) if body.segment else "не вказано"

        meta_prompt = (
            "Ти — система персоналізації AI-юриста. Згенеруй детальний персональний профіль "
            "для AI-асистента на основі даних користувача.\n\n"
            "Профіль повинен містити 5–7 речень і чітко описувати:\n"
            "1. Хто цей користувач, яка його роль і чим він займається у правовій сфері\n"
            "2. Який рівень юридичних знань у нього — чи можна вживати складну термінологію\n"
            "3. Які конкретні галузі права найбільш актуальні для нього\n"
            "4. Як саме треба подавати відповіді: стиль, деталізація, акценти\n"
            "5. Які практичні аспекти найважливіші (документи, ризики, строки тощо)\n\n"
            f"Дані користувача:\n"
            f"- Роль: {role_label}\n"
            f"- Спеціалізація: {sub_role_label}\n"
            f"- Сфери інтересів: {segment_label}\n\n"
            "Поверни ТІЛЬКИ текст профілю — суцільний параграф без заголовків, без JSON, без переліків. "
            "Обсяг: рівно 80–100 слів українською. Завжди завершуй думку повним реченням."
        )

        model_name = settings_cache.get("ai_model") or "gemini-2.5-flash"
        try:
            if not is_vertex_initialized():
                init_vertex_ai()
            model = GenerativeModel(model_name)
            response = await _asyncio.to_thread(
                model.generate_content,
                meta_prompt,
                generation_config=GenerationConfig(temperature=0.5, max_output_tokens=4096),
            )
            text = (response.text or "").strip()
            return {"prompt": text}
        except Exception as e:
            raise HTTPException(500, f"generate-user-prompt error: {e}")


    # ══════════════════════════════════════════════════════════════════════════════
