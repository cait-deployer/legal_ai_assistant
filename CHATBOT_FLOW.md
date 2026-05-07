# РЇРє РїСЂР°С†СЋС” URAI С‡Р°С‚-Р±РѕС‚

> РђРєС‚СѓР°Р»С–Р·РѕРІР°РЅРѕ: С‚СЂР°РІРµРЅСЊ 2026.
> Р”РѕРєСѓРјРµРЅС‚ РѕРїРёСЃСѓС” СЂРµР°Р»СЊРЅРёР№ РїРѕС‚С–Рє Р· `app/chat/page.tsx`, `app/api/ask/stream/route.ts`, `backend/server.py` С– `backend/qdrant_storage.py`.

## РљРѕСЂРѕС‚РєР° СЃС…РµРјР°

```mermaid
flowchart TD
    A[РљРѕСЂРёСЃС‚СѓРІР°С‡ РЅР°РґСЃРёР»Р°С” РїРёС‚Р°РЅРЅСЏ] --> B[Chat UI СЃС‚РІРѕСЂСЋС” С‡Р°С‚, СЏРєС‰Рѕ Р№РѕРіРѕ С‰Рµ РЅРµРјР°С”]
    B --> C[Р—Р±РµСЂС–РіР°С”С‚СЊСЃСЏ user message Сѓ Supabase]
    C --> D[Frontend Р±РµСЂРµ РѕСЃС‚Р°РЅРЅС– 6 РїРѕРІС–РґРѕРјР»РµРЅСЊ СЏРє history]
    D --> E[/api/ask/stream РїРµСЂРµРІС–СЂСЏС” auth, РїСЂРѕС„С–Р»СЊ, С‚Р°СЂРёС„, beta, features]
    E --> F[FastAPI /ask_stream]
    F --> G[RU to UA РїРµСЂРµРєР»Р°Рґ, СЏРєС‰Рѕ РїРёС‚Р°РЅРЅСЏ СЃС…РѕР¶Рµ РЅР° СЂРѕСЃС–Р№СЃСЊРєРµ]
    G --> H[Follow-up resolver РґР»СЏ СѓС‚РѕС‡РЅСЋРІР°Р»СЊРЅРёС… РїРёС‚Р°РЅСЊ]
    H --> I[РџР°СЂР°Р»РµР»СЊРЅРѕ: embedding РїРёС‚Р°РЅРЅСЏ + query rewrite]
    I --> J[Plan sources -> V2 Qdrant collections]
    J --> K[Routing probe РїРѕ РґРѕСЃС‚СѓРїРЅРёС… РєРѕР»РµРєС†С–СЏС…]
    K --> L[Vector search original/rewrite]
    L --> M[Boost, dedup, diversity, doc expansion]
    M --> N[Keyword search + title boost]
    N --> O[LLM reranker, СЏРєС‰Рѕ РєР°РЅРґРёРґР°С‚С–РІ Р±С–Р»СЊС€Рµ max_docs]
    O --> P[Р¤С–Р»СЊС‚СЂ СЃРєР°СЃРѕРІР°РЅРёС… РґРѕРєСѓРјРµРЅС‚С–РІ + context buckets]
    P --> Q[Gemini stream answer + parallel classification]
    Q --> R[Frontend РїРѕРєР°Р·СѓС” С‚РѕРєРµРЅРё]
    R --> S[Р—Р±РµСЂС–РіР°С”С‚СЊСЃСЏ assistant message, analytics, usage counter]
    S --> T[РљРѕР¶РµРЅ 2-Р№ user turn Р·Р°РїСѓСЃРєР°С”С‚СЊСЃСЏ summarize Сѓ С„РѕРЅС–]
```

## Р©Рѕ СЂРµР°Р»СЊРЅРѕ РІС–РґРїСЂР°РІР»СЏС” frontend

`app/chat/page.tsx` РїРµСЂРµРґ РіРµРЅРµСЂР°С†С–С”СЋ:

- Р±РµСЂРµ С‚С–Р»СЊРєРё РѕСЃС‚Р°РЅРЅС– 6 РїРѕРІС–РґРѕРјР»РµРЅСЊ, С‚РѕР±С‚Рѕ РїСЂРёР±Р»РёР·РЅРѕ 3 РґС–Р°Р»РѕРіРѕРІС– С…РѕРґРё;
- РІС–РґРїСЂР°РІР»СЏС” `context_summary: null`;
- summary РІСЃРµ РѕРґРЅРѕ РіРµРЅРµСЂСѓС”С‚СЊСЃСЏ С– Р·Р±РµСЂС–РіР°С”С‚СЊСЃСЏ РїС–СЃР»СЏ РєРѕР¶РЅРѕРіРѕ 2-РіРѕ user turn, Р°Р»Рµ Р·Р°СЂР°Р· РЅРµ РїС–РґРјС–С€СѓС”С‚СЊСЃСЏ РІ РЅР°СЃС‚СѓРїРЅРёР№ Р·Р°РїРёС‚;
- РїС–СЃР»СЏ РІС–РґРїРѕРІС–РґС– Р·Р±РµСЂС–РіР°С” assistant message, citations, analytics С– Р·Р°РїСѓСЃРєР°С” РѕРЅРѕРІР»РµРЅРЅСЏ Р»С–РјС–С‚С–РІ.

Р’Р°Р¶Р»РёРІРёР№ РЅСЋР°РЅСЃ: `context_summary` С” РІ backend-РєРѕРЅС‚СЂР°РєС‚С– С– РІ С‚Р°Р±Р»РёС†С– `chats`, Р°Р»Рµ Р·Р°СЂР°Р· РіРµРЅРµСЂР°С†С–СЏ РІС–РґРїРѕРІС–РґС– РЅРёРј РЅРµ РєРѕСЂРёСЃС‚СѓС”С‚СЊСЃСЏ С‡РµСЂРµР· frontend payload.

## API route РїРµСЂРµРґ backend

`app/api/ask/stream/route.ts`:

- РїРµСЂРµРІС–СЂСЏС” Supabase auth;
- С‡РёС‚Р°С” `profiles`: С‚Р°СЂРёС„, beta, onboarding role/sub_role/segment, personal prompt, response preferences, usage fields;
- РґР»СЏ beta РІРёРєРѕСЂРёСЃС‚РѕРІСѓС” effective plan `pro`;
- Р±РµСЂРµ `max_docs_retrieved` Р· `subscription_plans`;
- Р±РµСЂРµ source/response features Р· `plan_features`;
- СЏРєС‰Рѕ С” source features, Р·Р°РІР¶РґРё РґРѕРґР°С” `mod` С– `zir` РґРѕ `filter_sources`;
- silently downgrades locked response prefs:
  - `full` С‚С–Р»СЊРєРё РґР»СЏ Pro/Beta;
  - `detailed` РґР»СЏ paid/Beta;
- РїСЂРѕРєРёРґСѓС” Сѓ Python backend:
  `question`, `max_docs`, `filter_sources`, `response_features`, `user_profile`, `history`, `context_summary`, `ai_personal_prompt`, `response_length_pref`, `response_lang_style`.

## РЇРє backend С€СѓРєР°С” РґР¶РµСЂРµР»Р°

РћСЃРЅРѕРІРЅРёР№ pipeline Р¶РёРІРµ РІ `_ask_pipeline()` Сѓ `backend/server.py`.

1. РЇРєС‰Рѕ РїРёС‚Р°РЅРЅСЏ СЃС…РѕР¶Рµ РЅР° СЂРѕСЃС–Р№СЃСЊРєРµ, Gemini РїРµСЂРµРєР»Р°РґР°С” Р№РѕРіРѕ РЅР° СѓРєСЂР°С—РЅСЃСЊРєСѓ РґР»СЏ РїРѕС€СѓРєСѓ.
2. РЇРєС‰Рѕ С” history, follow-up resolver РїРµСЂРµС‚РІРѕСЂСЋС” РєРѕСЂРѕС‚РєРµ СѓС‚РѕС‡РЅРµРЅРЅСЏ РЅР° СЃР°РјРѕСЃС‚С–Р№РЅРёР№ РїРѕС€СѓРєРѕРІРёР№ Р·Р°РїРёС‚.
3. РџР°СЂР°Р»РµР»СЊРЅРѕ СЂРѕР±Р»СЏС‚СЊСЃСЏ embedding РїРёС‚Р°РЅРЅСЏ С– query rewrite С‡РµСЂРµР· `rewrite_model`.
4. РўР°СЂРёС„РЅС– source features РїРµСЂРµС‚РІРѕСЂСЋСЋС‚СЊСЃСЏ РЅР° СЃРїРёСЃРѕРє РґРѕР·РІРѕР»РµРЅРёС… V2 РєРѕР»РµРєС†С–Р№.
5. Routing probe СЂРѕР±РёС‚СЊ Р»РµРіРєРёР№ Qdrant РїРѕС€СѓРє РїРѕ РґРѕСЃС‚СѓРїРЅРёС… РєРѕР»РµРєС†С–СЏС… С– Р·РІСѓР¶СѓС” СЃРїРёСЃРѕРє.
6. Vector search С€СѓРєР°С” РїРѕ original embedding С–, СЏРєС‰Рѕ rewrite СѓСЃРїС–С€РЅРёР№, РїРѕ rewrite embedding.
7. Р РµР·СѓР»СЊС‚Р°С‚Рё merge/dedup РїРѕ `(law_id, chunk_index)`.
8. РЇРєС‰Рѕ top raw score РЅРёР¶С‡Рµ `raw_gate_threshold`, РІРєР»СЋС‡Р°С”С‚СЊСЃСЏ low-confidence СЂРµР¶РёРј С– РґРѕРґР°СЋС‚СЊСЃСЏ extra collections Сѓ РјРµР¶Р°С… С‚Р°СЂРёС„Сѓ.
9. Score РєРѕСЂРёРіСѓС”С‚СЊСЃСЏ:
   - `laws_supreme_v2` РјР°С” soft penalty;
   - tax queries Р±СѓСЃС‚СЏС‚СЊ `laws_zir_v2`;
   - `rada_*` С– `laws_positions_v2` Р±СѓСЃС‚СЏС‚СЊСЃСЏ С‡РµСЂРµР· `rada_source_boost`;
   - doc type score РїС–РґРЅС–РјР°С” РєРѕРґРµРєСЃРё/Р·Р°РєРѕРЅРё/РїРѕСЃС‚Р°РЅРѕРІРё С– Р·РЅРёР¶СѓС” Р»РёСЃС‚Рё.
10. Dedup Р·Р°Р»РёС€Р°С” РјР°РєСЃРёРјСѓРј 2 chunks РЅР° РѕРґРёРЅ `law_id`.
11. Diversity РѕР±РјРµР¶СѓС” court/positions, С‰РѕР± РІРѕРЅРё РЅРµ Р·Р°Р№РЅСЏР»Рё РІРµСЃСЊ context.
12. Doc expansion РґРѕР±РёСЂР°С” СЃСѓСЃС–РґРЅС– chunks Сѓ СЃРёР»СЊРЅРёС… РґРѕРєСѓРјРµРЅС‚С–РІ; РґР»СЏ РґСѓР¶Рµ СЃРёР»СЊРЅРѕРіРѕ top-1 РјРѕР¶Рµ РІР·СЏС‚Рё РґРѕ 20 chunks РѕРґРЅРѕРіРѕ Р·Р°РєРѕРЅСѓ.
13. Keyword search С‡РµСЂРµР· Qdrant MatchText С€СѓРєР°С” Р±СѓРєРІР°Р»СЊРЅС– Р·Р±С–РіРё РІ `content`.
14. Title boost С€СѓРєР°С” Р·Р±С–РіРё Сѓ `source` С– РґРѕР±РёСЂР°С” chunks Р· РґРѕРєСѓРјРµРЅС‚С–РІ, РЅР°Р·РІР° СЏРєРёС… Р·Р±С–РіР»Р°СЃСЊ С–Р· РїРёС‚Р°РЅРЅСЏРј.
15. LLM reranker РІРёР±РёСЂР°С” РЅР°Р№РєСЂР°С‰С– chunks, Р°Р»Рµ protected chunks Р· РІР°Р¶Р»РёРІРёС… РґРѕРєСѓРјРµРЅС‚С–РІ РјРѕР¶СѓС‚СЊ РѕР±С–Р№С‚Рё reranker.
16. РЇРєС‰Рѕ СЂРµР·СѓР»СЊС‚Р°С‚ СЃР»Р°Р±РєРёР№ С– РЅРµ low-confidence, backend РјРѕР¶Рµ РїРѕРІРµСЂРЅСѓС‚Рё early answer "РЅРµ Р·РЅР°Р№РґРµРЅРѕ".
17. РЎРєР°СЃРѕРІР°РЅС– РґРѕРєСѓРјРµРЅС‚Рё С„С–Р»СЊС‚СЂСѓСЋС‚СЊСЃСЏ РїРµСЂРµРґ РєРѕРЅС‚РµРєСЃС‚РѕРј.
18. РљРѕРЅС‚РµРєСЃС‚ РіСЂСѓРїСѓС”С‚СЊСЃСЏ:
   - Р·Р°РєРѕРЅРё Р Р°РґРё + wiki + MOD/ZIR/С–РЅС€С–: РґРѕ 15 chunks;
   - РљРњРЈ: РґРѕ 8 chunks;
   - СЃСѓРґРѕРІР° РїСЂР°РєС‚РёРєР°, РїСЂР°РІРѕРІС– РїРѕР·РёС†С–С—, РљРЎРЈ: РґРѕ 6 chunks;
   - Р·Р°РіР°Р»СЊРЅРёР№ cap: 80 000 СЃРёРјРІРѕР»С–РІ.
19. Gemini РіРµРЅРµСЂСѓС” streamed answer, РїР°СЂР°Р»РµР»СЊРЅРѕ Р·Р°РїСѓСЃРєР°С”С‚СЊСЃСЏ classification РґР»СЏ analytics.
20. РЇРєС‰Рѕ РІС–РґРїРѕРІС–РґСЊ РѕР±СЂС–Р·Р°Р»Р°СЃСЊ РїРѕ С‚РѕРєРµРЅР°С…, backend РїСЂРѕР±СѓС” РґРѕР±СѓРґСѓРІР°С‚Рё Р·Р°РІРµСЂС€РµРЅРЅСЏ.

## РљРѕР»РµРєС†С–С—

Р РµР°Р»СЊРЅРёР№ production search Р·Р°СЂР°Р· РїСЂР°С†СЋС” Р· V2:

- `rada_finance_v2`
- `rada_state_v2`
- `rada_personnel_v2`
- `rada_court_v2`
- `rada_intl_v2`
- `rada_labor_v2`
- `rada_civil_v2`
- `rada_criminal_v2`
- `rada_admin_v2`
- `rada_housing_v2`
- `rada_land_v2`
- `rada_industry_v2`
- `rada_other_v2`
- `laws_supreme_v2`
- `laws_wiki_v2`
- `laws_ccu_v2`
- `laws_positions_v2`
- `laws_kmu_v2`
- `laws_mod_v2`
- `laws_zir_v2`

V2 РІРёРєРѕСЂРёСЃС‚РѕРІСѓС” `gemini-embedding-001` С– 3072 dimensions. РЎС‚Р°СЂС– V1 РєРѕР»РµРєС†С–С— Р·Р°Р»РёС€Р°СЋС‚СЊСЃСЏ С–СЃС‚РѕСЂРёС‡РЅРѕ/РґР»СЏ legacy admin flows, Р°Р»Рµ РѕСЃРЅРѕРІРЅРёР№ chat search Р±РµСЂРµ `ALL_V2_COLLECTIONS`.

## Response preferences

РџСЂРѕС„С–Р»СЊ РєРѕСЂРёСЃС‚СѓРІР°С‡Р° РјР°С”:

- `response_length_pref`: `short`, `standard`, `detailed`, `full`;
- `response_lang_style`: `legal`, `plain`.

Backend РґРѕРґР°С” СЂС–Р·РЅС– С–РЅСЃС‚СЂСѓРєС†С–С— С– token bounds:

| Mode | Token bounds | РћСЂС–С”РЅС‚РёСЂ |
| --- | ---: | --- |
| `short` | 1200-1800 | РєРѕРјРїР°РєС‚РЅР° РІС–РґРїРѕРІС–РґСЊ, 2-4 Р°Р±Р·Р°С†Рё Р°Р±Рѕ 4-6 РїСѓРЅРєС‚С–РІ |
| `standard` | 1800-2600 | Р·Р±Р°Р»Р°РЅСЃРѕРІР°РЅР° РІС–РґРїРѕРІС–РґСЊ РґРѕ 400 СЃР»С–РІ |
| `detailed` | 4200-5600 | 5-7 РєРѕСЂРѕС‚РєРёС… СЃРµРєС†С–Р№, РґРѕ 850 СЃР»С–РІ |
| `full` | 6500-9000 | 7-9 СЃРµРєС†С–Р№, legal memo, РґРѕ 1600 СЃР»С–РІ |

`plain` РґРѕРґР°С” РІРёРјРѕРіСѓ РїРёСЃР°С‚Рё РїСЂРѕСЃС‚РѕСЋ РјРѕРІРѕСЋ Р±РµР· СЋСЂРёРґРёС‡РЅРѕРіРѕ Р¶Р°СЂРіРѕРЅСѓ. `legal` РІРёРєРѕСЂРёСЃС‚РѕРІСѓС” С‚РѕС‡РЅС– СЋСЂРёРґРёС‡РЅС– С‚РµСЂРјС–РЅРё.

## Р›С–РјС–С‚Рё, usage С– beta

- Frontend Р±Р»РѕРєСѓС” РІС–РґРїСЂР°РІРєСѓ, СЏРєС‰Рѕ `requests_this_month >= monthly_limit + bonus_requests`.
- `/api/ask/stream` РґРѕРґР°С‚РєРѕРІРѕ РјР°С” guard РґР»СЏ free accounts Р· РѕРґРЅР°РєРѕРІРёРј `browser_fingerprint`.
- Usage counter Р·Р±С–Р»СЊС€СѓС”С‚СЊСЃСЏ РїС–СЃР»СЏ Р·Р±РµСЂРµР¶РµРЅРЅСЏ assistant message Сѓ `POST /api/chats/[id]/messages`.
- Free plan РјР°С” one-time limit Р±РµР· rolling reset.
- Paid plans РјР°СЋС‚СЊ 30-day rolling window.
- Beta РєРѕСЂРёСЃС‚СѓРІР°С‡ РЅРµ Р±Р»РѕРєСѓС”С‚СЊСЃСЏ Р»С–РјС–С‚РѕРј Сѓ chat UI С– API route РїСЂР°С†СЋС” Р· РЅРёРј СЏРє Р· `pro`.

## Р”Рµ РЅР°Р№Р±С–Р»СЊС€Рµ РЅР°РІР°РЅС‚Р°Р¶РµРЅРЅСЏ

РћРґРёРЅ user request РјРѕР¶Рµ РІРєР»СЋС‡Р°С‚Рё РєС–Р»СЊРєР° РґРѕСЂРѕРіРёС… РѕРїРµСЂР°С†С–Р№:

- Gemini RU to UA translation;
- Gemini follow-up resolver;
- Gemini query rewrite;
- Qdrant routing probe РїРѕ Р±Р°РіР°С‚СЊРѕС… РєРѕР»РµРєС†С–СЏС…;
- vector search original + rewrite;
- doc expansion;
- keyword MatchText scroll;
- title MatchText scroll;
- Gemini LLM reranker;
- Gemini main answer stream;
- Gemini classification;
- optional answer completion;
- С„РѕРЅРѕРІРёР№ summary С– title generation РїС–СЃР»СЏ РІС–РґРїРѕРІС–РґС–.

РўРѕРјСѓ РїС–Рґ РєС–Р»СЊРєРѕРјР° РѕРґРЅРѕС‡Р°СЃРЅРёРјРё РєРѕСЂРёСЃС‚СѓРІР°С‡Р°РјРё РїРѕС‚РѕС‡РЅРёР№ pipeline РјРѕР¶Рµ РґР°РІР°С‚Рё РІРёСЃРѕРєРµ РЅР°РІР°РЅС‚Р°Р¶РµРЅРЅСЏ С– timeout/server unavailable.

## Р©Рѕ РІР°Р¶Р»РёРІРѕ РїР°Рј'СЏС‚Р°С‚Рё

- Р”РѕРєСѓРјРµРЅС‚Рё "РЅРµ Р·РЅР°Р№РґРµРЅРѕ" РјРѕР¶СѓС‚СЊ Р·'СЏРІР»СЏС‚РёСЃСЏ РЅРµ С‚С–Р»СЊРєРё С‚РѕРјСѓ, С‰Рѕ РґР¶РµСЂРµР» РЅРµРјР°С”, Р° Р№ С‡РµСЂРµР· routing/search thresholds Р°Р±Рѕ timeout РґРѕ РіРµРЅРµСЂР°С†С–С—.
- `context_summary` Р·Р°СЂР°Р· Р·Р±РµСЂС–РіР°С”С‚СЊСЃСЏ, Р°Р»Рµ РЅРµ РІРёРєРѕСЂРёСЃС‚РѕРІСѓС”С‚СЊСЃСЏ РІ prompt.
- `mod` С– `zir` РґРѕРґР°СЋС‚СЊСЃСЏ РґРѕ Р±СѓРґСЊ-СЏРєРѕРіРѕ РїР»Р°РЅСѓ, РґРµ С” С…РѕС‡Р° Р± РѕРґРЅРµ source feature.
- `tokens_used` Сѓ SSE meta Р·Р°СЂР°Р· РЅРµ СЂР°С…СѓС”С‚СЊСЃСЏ СЂРµР°Р»СЊРЅРѕ С– С‡Р°СЃС‚Рѕ РґРѕСЂС–РІРЅСЋС” 0.
