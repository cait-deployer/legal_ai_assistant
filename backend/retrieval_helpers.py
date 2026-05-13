"""Retrieval, query-planning, scoring and answer-completion helpers for server.py.

This module is intentionally behavior-preserving: helpers were moved out of
server.py without changing their public names, so the FastAPI routes and
pipeline orchestration can keep using the same functions.
"""

import json
import logging
import re
from datetime import datetime, timezone

logger = logging.getLogger("uvicorn.error")

try:
    import pymorphy3 as _pymorphy3
    _ua_morph = _pymorphy3.MorphAnalyzer(lang="uk")

    def _ua_lemma(w: str) -> str:
        try:
            return _ua_morph.parse(w.lower())[0].normal_form
        except Exception:
            return w.lower()
except ImportError:
    def _ua_lemma(w: str) -> str:
        return w.lower()

_CLF_FALLBACK = {"sentiment": "neutral", "complexity_score": 1, "user_intent": "консультація"}


_QUERY_STOPWORDS = {
    "дай", "дайте", "надай", "надайте", "інфо", "інформацію", "інформація",
    "щодо", "стосовно", "про", "по", "для", "при", "або", "или", "та", "і",
    "й", "в", "у", "на", "з", "із", "від", "до", "як", "які", "який", "яка",
    "это", "це", "ця", "цей", "вони", "воно", "там", "так", "само", "тому",
    "мені", "мене", "потрібно", "потрібна", "потрібен", "нужен", "нужна",
    "рекомендація", "рекомендацию", "краще", "лучше", "обрати", "выбрать",
    "вибір", "вибору", "критерій", "критерії", "критерии", "діяльність",
    "діяльності", "особа", "осіб", "человек", "людей", "команда", "команди",
    "будь", "ласка", "можливо", "может", "уточни", "питання", "вопрос",
    "може", "можуть", "могти", "можно", "займається", "займатися", "займаються",
}

_LEGAL_ACRONYMS = {"фоп", "тов", "ооо", "пдв", "єп", "квед", "цпд", "кзпп", "кму", "дпс", "зір"}


def _looks_like_acronym(token: str) -> bool:
    token = (token or "").strip("«»\"'()[]{}.,;:!?")
    letters = [ch for ch in token if ch.isalpha()]
    if not (2 <= len(letters) <= 8):
        return False
    if any("A" <= ch <= "Z" or "А" <= ch <= "Я" or ch in "ІЇЄҐ" for ch in letters) and token.upper() == token:
        return True
    compact = "".join(letters).lower()
    vowels = set("aeiouаеєиіїоуюя")
    return len(compact) <= 5 and not any(ch in vowels for ch in compact)


_UA_NUMBER_FORMS: dict[int, tuple[str, ...]] = {
    0: ("нуль", "нуля"),
    1: ("один", "одного", "одна", "однієї"),
    2: ("два", "двох", "дві"),
    3: ("три", "трьох"),
    4: ("чотири", "чотирьох"),
    5: ("п'ять", "п’ять", "пять", "п'яти", "п’яти", "пяти"),
    6: ("шість", "шести"),
    7: ("сім", "семи"),
    8: ("вісім", "восьми"),
    9: ("дев'ять", "дев’ять", "девять", "дев'яти", "дев’яти", "девяти"),
    10: ("десять", "десяти"),
    11: ("одинадцять", "одинадцяти"),
    12: ("дванадцять", "дванадцяти"),
    13: ("тринадцять", "тринадцяти"),
    14: ("чотирнадцять", "чотирнадцяти"),
    15: ("п'ятнадцять", "п’ятнадцять", "пятнадцять", "п'ятнадцяти", "п’ятнадцяти", "пятнадцяти"),
    16: ("шістнадцять", "шістнадцяти"),
    17: ("сімнадцять", "сімнадцяти"),
    18: ("вісімнадцять", "вісімнадцяти"),
    19: ("дев'ятнадцять", "дев’ятнадцять", "девятнадцять", "дев'ятнадцяти", "дев’ятнадцяти", "девятнадцяти"),
    20: ("двадцять", "двадцяти"),
    30: ("тридцять", "тридцяти"),
    40: ("сорок", "сорока"),
    50: ("п'ятдесят", "п’ятдесят", "пятдесят", "п'ятдесяти", "п’ятдесяти", "пятдесяти"),
    60: ("шістдесят", "шістдесяти"),
    70: ("сімдесят", "сімдесяти"),
    80: ("вісімдесят", "вісімдесяти"),
    90: ("дев'яносто", "дев’яносто", "девяносто", "дев'яноста", "дев’яноста", "девяноста"),
    100: ("сто", "ста"),
    200: ("двісті", "двохсот"),
    300: ("триста", "трьохсот"),
    400: ("чотириста", "чотирьохсот"),
    500: ("п'ятсот", "п’ятсот", "пятсот", "п'ятисот", "п’ятисот", "пятисот"),
    600: ("шістсот", "шестисот"),
    700: ("сімсот", "семисот"),
    800: ("вісімсот", "восьмисот"),
    900: ("дев'ятсот", "дев’ятсот", "девятсот", "дев'ятисот", "дев’ятисот", "девятисот"),
}


def _number_word_variants(raw: str) -> list[str]:
    match = re.search(r"\d{1,3}", raw or "")
    if not match:
        return []
    n = int(match.group(0))
    if n < 0 or n > 999:
        return []
    direct = list(_UA_NUMBER_FORMS.get(n, ()))
    if direct:
        return direct

    parts: list[tuple[str, ...]] = []
    remainder = n
    if remainder >= 100:
        hundreds = (remainder // 100) * 100
        parts.append(_UA_NUMBER_FORMS.get(hundreds, ()))
        remainder %= 100
    if remainder:
        if remainder in _UA_NUMBER_FORMS:
            parts.append(_UA_NUMBER_FORMS.get(remainder, ()))
        else:
            tens = (remainder // 10) * 10
            units = remainder % 10
            parts.append(_UA_NUMBER_FORMS.get(tens, ()))
            parts.append(_UA_NUMBER_FORMS.get(units, ()))

    variants: list[str] = []
    for forms in parts:
        variants.extend(forms[:3])
    if parts and all(parts):
        variants.append(" ".join(forms[0] for forms in parts if forms))
        if len(parts) > 1:
            variants.append(" ".join((forms[1] if len(forms) > 1 else forms[0]) for forms in parts if forms))
    return list(dict.fromkeys(v for v in variants if v))


def _query_terms(text: str, limit: int = 24) -> list[str]:
    terms: list[str] = []
    for token in re.findall(r"[\w'-]+", text or ""):
        raw = token.lower()
        has_digit = any(ch.isdigit() for ch in raw)
        is_acronym = raw in _LEGAL_ACRONYMS or _looks_like_acronym(token)
        if (len(raw) < 4 and not is_acronym and not has_digit) or raw in _QUERY_STOPWORDS:
            continue
        terms.append(raw)
        if has_digit:
            terms.extend(_number_word_variants(raw))
        lemma = _ua_lemma(raw)
        if lemma and lemma not in _QUERY_STOPWORDS:
            terms.append(lemma)
    return list(dict.fromkeys(terms))[:limit]


def _clean_plan_list(value, *, limit: int, min_len: int = 2, max_len: int = 140) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        text = re.sub(r"\s+", " ", item).strip()
        if not (min_len <= len(text) <= max_len):
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= limit:
            break
    return out


def _empty_query_plan(question: str) -> dict:
    return {
        "search_query": question[:350],
        "legal_terms": [],
        "aspects": [],
        "title_queries": [],
        "title_must_terms": [],
        "title_nice_terms": [],
        "title_exclude_terms": [],
        "primary_act_hints": [],
        "source_preferences": [],
        "target_collections": [],
        "should_compare": False,
        "needs_clarification": False,
        "clarification_questions": [],
        "article_hint": None,
        "article_confidence": 0.0,
        "evidence_subquestions": [],
    }


_QUERY_ALIAS_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("фоп", "фізична особа-підприємець", "фізична особа підприємець"),
        (
            "фізична особа-підприємець",
            "фізична особа підприємець",
            "платник єдиного податку",
            "спрощена система оподаткування",
            "наймані працівники",
            "цивільно-правовий договір",
        ),
        ("оподаткування", "найм і підрядники", "ліміти доходу"),
    ),
    (
        ("тов", "ооо", "обмеженою відповідальністю", "ограниченной ответственностью"),
        (
            "товариство з обмеженою відповідальністю",
            "учасники товариства",
            "статутний капітал",
            "відповідальність товариства",
            "виконавчий орган",
            "корпоративне управління",
        ),
        ("відповідальність", "корпоративна структура", "управління товариством"),
    ),
    (
        ("пдв", "ндс"),
        ("податок на додану вартість", "платник ПДВ", "реєстрація платником ПДВ"),
        ("ПДВ",),
    ),
    (
        ("цпд", "цивільно-правов", "подряд", "підряд"),
        ("цивільно-правовий договір", "договір підряду", "трудові відносини"),
        ("найм і підрядники",),
    ),
    (
        ("it", "іт", "айті", "інформаційні технології"),
        ("інформаційні технології", "комп'ютерне програмування", "IT-послуги"),
        ("вид діяльності", "зовнішньоекономічна діяльність"),
    ),
)


_QUERY_TITLE_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("податков", "єдиний податок", "пдв", "пдфо", "фоп", "пільг", "льгот"),
        ("Податковий кодекс України", "єдиний податок", "податкові пільги"),
        ("rada", "zir"),
        ("податкові пільги", "ПДВ та прибуток"),
    ),
    (
        ("компенсац", "відшкодуван", "витрат", "державна підтримка", "підтримк"),
        ("компенсація витрат", "державна підтримка", "порядок використання коштів"),
        ("kmu", "rada"),
        ("компенсація витрат", "фінансова підтримка"),
    ),
    (
        ("критично", "важлив", "бронюван", "бронь", "мобілізац", "військовозобов", "міноборони", "зсу", "оборон"),
        ("критично важливі підприємства", "особливий період", "бронювання військовозобов'язаних"),
        ("kmu", "rada", "mod"),
        ("критично важливий статус", "бронювання працівників"),
    ),
    (
        ("тов", "ооо", "обмеженою відповідальністю"),
        ("товариства з обмеженою відповідальністю", "державна реєстрація юридичних осіб"),
        ("rada",),
        ("корпоративна структура", "державна реєстрація"),
    ),
)


_VALID_PLANNER_COLLECTIONS: set[str] = {
    "rada_finance_v2",
    "rada_state_v2",
    "rada_personnel_v2",
    "rada_court_v2",
    "rada_intl_v2",
    "rada_labor_v2",
    "rada_civil_v2",
    "rada_criminal_v2",
    "rada_admin_v2",
    "rada_housing_v2",
    "rada_land_v2",
    "rada_industry_v2",
    "rada_other_v2",
    "laws_supreme_v2",
    "laws_wiki_v2",
    "laws_ccu_v2",
    "laws_positions_v2",
    "laws_kmu_v2",
    "laws_mod_v2",
    "laws_zir_v2",
}


_RADA_COLLECTION_GUIDE = (
    "Rada category-to-collection map: "
    "h2 banks/finance/budget, h3 accounting/tax/audit/statistics, h26 securities, h23 customs/ZED -> rada_finance_v2; "
    "h4 state/public order/citizenship -> rada_state_v2; "
    "h27 personnel/awards -> rada_personnel_v2; "
    "h22 courts/prosecution/justice, h30 court practice, h1 commercial procedure -> rada_court_v2; "
    "h11 international relations -> rada_intl_v2; "
    "h19 labor/employment, h20 social security/insurance -> rada_labor_v2; "
    "h5 civil/civil procedure, h16 health/family/youth/sport/tourism, h13 notary/advocacy -> rada_civil_v2; "
    "h25 criminal/criminal procedure/enforcement -> rada_criminal_v2; "
    "h8 administrative liability, h10 licensing/certification/patents/metrology, h31 economic regulation principles -> rada_admin_v2; "
    "h6 housing/utility, h21 construction/architecture -> rada_housing_v2; "
    "h9 natural resources/land/environment, h18 agriculture/agro -> rada_land_v2; "
    "h7 transport/communications/information, h17 industry/energy, h15 enterprises/business/investment -> rada_industry_v2; "
    "h12 science/education/culture, h14 defense/security/armed forces, h24 trade/food service/consumer services, "
    "h28 regional law, h29 draft/amendment acts, h32 nuclear/Chornobyl -> rada_other_v2. "
    "Other sources: KMU resolutions/orders -> laws_kmu_v2; tax Q&A -> laws_zir_v2; MOD orders -> laws_mod_v2; "
    "Supreme Court reviews -> laws_supreme_v2; legal positions -> laws_positions_v2; CCU -> laws_ccu_v2; wiki background -> laws_wiki_v2."
)


_QUERY_COLLECTION_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("податков", "єдиний податок", "пдв", "пдфо", "прибуток", "фоп", "пільг", "льгот"),
        ("rada_finance_v2", "laws_zir_v2"),
    ),
    (
        ("компенсац", "відшкодуван", "витрат", "державна підтримка", "підтримк", "порядок використання коштів"),
        ("laws_kmu_v2", "rada_finance_v2", "rada_industry_v2"),
    ),
    (
        ("критично", "важлив", "бронюван", "бронь", "мобілізац", "особливий період", "військовозобов", "міноборони", "зсу", "оборон"),
        ("laws_kmu_v2", "laws_mod_v2", "rada_industry_v2", "rada_labor_v2"),
    ),
    (
        ("харч", "продукт", "корм", "безпечності"),
        ("laws_kmu_v2", "rada_industry_v2", "rada_finance_v2"),
    ),
    (
        ("фітосанітар", "ветеринар", "імпорт", "експорт", "укртзед"),
        ("laws_kmu_v2", "rada_other_v2", "rada_land_v2", "rada_finance_v2"),
    ),
    (
        ("тов", "ооо", "обмеженою відповідальністю", "учасники товариства", "статутний капітал"),
        ("rada_industry_v2", "rada_civil_v2", "rada_admin_v2"),
    ),
    (
        ("працівник", "найман", "трудов", "кзпп", "цпд", "договір підряду"),
        ("rada_labor_v2", "rada_civil_v2"),
    ),
    (
        ("штраф", "адмін", "адміністративн", "купап", "відповідальність"),
        ("rada_admin_v2", "rada_court_v2"),
    ),
)


_QUERY_TITLE_CONSTRAINT_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("податков", "єдиний податок", "пдв", "пдфо", "прибуток", "пільг", "льгот"),
        ("Податковий кодекс України",),
        ("податкові пільги", "єдиний податок", "ПДВ", "податок на прибуток"),
        (),
    ),
    (
        ("компенсац", "відшкодуван", "витрат", "державна підтримка", "підтримк"),
        ("державна підтримка", "порядок використання коштів"),
        ("компенсація витрат", "фінансова підтримка", "воєнний стан"),
        (),
    ),
    (
        ("критично", "важлив", "бронюван", "бронь", "мобілізац", "особливий період", "військовозобов", "міноборони", "зсу", "оборон"),
        ("критично важливі", "функціонування економіки"),
        ("бронювання військовозобов'язаних", "особливий період"),
        (),
    ),
    (
        ("харч", "продукт", "корм", "безпечності"),
        ("харчові продукти",),
        ("виробництво харчових продуктів", "безпечність харчових продуктів"),
        ("електричної енергії", "Енергоринок", "виробників електричної енергії"),
    ),
    (
        ("фітосанітар", "ветеринар", "імпорт", "експорт", "укртзед"),
        ("фітосанітар", "ветеринар", "харчових продуктів"),
        ("імпорт", "експорт", "УКТЗЕД", "воєнний стан"),
        ("електричної енергії", "Енергоринок"),
    ),
    (
        ("it", "іт", "айті", "програмуван", "інформаційні технолог"),
        ("інформаційні технології", "Дія Сіті"),
        ("комп'ютерне програмування", "IT-послуги"),
        ("фермерське господарство", "сільськогосподарський"),
    ),
)


def _clean_plan_collections(value, *, limit: int = 8) -> list[str]:
    cols = _clean_plan_list(value, limit=limit, min_len=6, max_len=40)
    return [c for c in cols if c in _VALID_PLANNER_COLLECTIONS]


def _clean_evidence_subquestions(value, *, limit: int = 5) -> list[dict]:
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        question = re.sub(r"\s+", " ", str(item.get("question") or "")).strip()
        if not (8 <= len(question) <= 220):
            continue
        sid = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(item.get("id") or "").strip().lower())[:48]
        if not sid:
            sid = f"q{len(out) + 1}"
        key = question.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "id": sid,
            "question": question,
            "must_find": _clean_plan_list(item.get("must_find"), limit=6, min_len=3, max_len=80),
            "avoid_if_only": _clean_plan_list(item.get("avoid_if_only"), limit=5, min_len=3, max_len=80),
            "target_collections": _clean_plan_collections(item.get("target_collections"), limit=5),
            "source_preferences": _clean_plan_list(item.get("source_preferences"), limit=4, min_len=3, max_len=20),
        })
        if len(out) >= limit:
            break
    return out


def _evidence_block(
    sid: str,
    question: str,
    must_find: list[str],
    collections: list[str],
    prefs: list[str],
    avoid: list[str] | None = None,
) -> dict:
    return {
        "id": sid,
        "question": question,
        "must_find": must_find,
        "avoid_if_only": avoid or [],
        "target_collections": collections,
        "source_preferences": prefs,
    }


def _procedure_evidence_subquestions(question: str) -> list[dict]:
    """Evidence checklist for broad procedural questions.

    This is a domain scaffold, not an answer template: it tells retrieval what
    kinds of legal proof must be present so one narrow exception does not become
    the whole answer.
    """
    q = (question or "").lower()
    procedural = _has_any_marker(q, (
        "як законно", "як правильно", "як оформ", "як звільн", "порядок", "процедур",
        "що зробити", "які кроки", "документи", "оформлення",
    ))
    if not procedural:
        return []

    if _has_any_marker(q, ("звільн", "працівник", "роботодав", "трудов")):
        cols = ["rada_labor_v2"]
        prefs = ["rada"]
        return [
            _evidence_block(
                "labor_termination_grounds",
                "Загальні підстави припинення трудового договору та звільнення працівника",
                ["припинення трудового договору", "підстави", "звільнення", "працівник"],
                cols,
                prefs,
            ),
            _evidence_block(
                "labor_employee_initiative",
                "Звільнення працівника за власним бажанням або за угодою сторін",
                ["власне бажання", "угода сторін", "строк", "заява"],
                cols,
                prefs,
            ),
            _evidence_block(
                "labor_employer_initiative",
                "Звільнення з ініціативи роботодавця: допустимі підстави та заборони",
                ["ініціатива роботодавця", "підстави", "забороняється", "скорочення"],
                cols,
                prefs,
            ),
            _evidence_block(
                "labor_union_and_protected",
                "Додаткові гарантії при звільненні: профспілка, захищені категорії, обмеження",
                ["профспілка", "згода", "гарантії", "обмеження"],
                cols,
                prefs,
            ),
            _evidence_block(
                "labor_final_settlement",
                "Оформлення звільнення: наказ, видача документів, остаточний розрахунок",
                ["наказ", "трудова книжка", "копія наказу", "розрахунок"],
                cols,
                prefs,
            ),
        ]

    return [
        _evidence_block(
            "procedure_basis",
            "Правова підстава процедури та хто має право її застосовувати",
            ["підстава", "право", "орган", "суб'єкт"],
            ["rada_admin_v2", "laws_kmu_v2", "laws_mod_v2"],
            ["rada", "kmu", "mod"],
        ),
        _evidence_block(
            "procedure_steps",
            "Основні кроки процедури, документи та строки",
            ["порядок", "документи", "строк", "заява"],
            ["rada_admin_v2", "laws_kmu_v2", "laws_mod_v2"],
            ["rada", "kmu", "mod"],
        ),
        _evidence_block(
            "procedure_limits",
            "Обмеження, винятки та ризики неправильного оформлення процедури",
            ["обмеження", "винятки", "відмова", "відповідальність"],
            ["rada_admin_v2", "laws_kmu_v2", "laws_mod_v2"],
            ["rada", "kmu", "mod"],
        ),
    ]


def _merge_unique_strings(*groups: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for item in group or []:
            text = re.sub(r"\s+", " ", str(item)).strip()
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(text)
            if len(out) >= limit:
                return out
    return out


def _scoring_query_text(
    search_question: str,
    rewritten_query: str | None = None,
    planner_terms: list[str] | None = None,
    act_hints: list[str] | None = None,
) -> str:
    parts: list[str] = []
    if rewritten_query:
        parts.append(rewritten_query)
    if planner_terms:
        parts.append(" ".join(planner_terms))
    if act_hints:
        parts.append(" ".join(act_hints))
    if search_question:
        parts.append(search_question)
    return " ".join(part for part in parts if part).strip()


def _plan_log_summary(plan: dict) -> dict:
    plan = plan or {}
    usable = any(plan.get(k) for k in (
        "legal_terms", "aspects", "title_queries", "title_must_terms", "title_nice_terms",
        "title_exclude_terms", "primary_act_hints", "source_preferences", "target_collections",
    ))
    return {
        "usable": usable,
        "search": (plan.get("search_query") or "")[:120],
        "terms": (plan.get("legal_terms") or [])[:6],
        "aspects": (plan.get("aspects") or [])[:5],
        "titles": (plan.get("title_queries") or [])[:5],
        "must_titles": (plan.get("title_must_terms") or [])[:5],
        "nice_titles": (plan.get("title_nice_terms") or [])[:5],
        "exclude_titles": (plan.get("title_exclude_terms") or [])[:5],
        "acts": (plan.get("primary_act_hints") or [])[:4],
        "sources": (plan.get("source_preferences") or [])[:5],
        "collections": (plan.get("target_collections") or [])[:8],
        "subq": [
            {
                "id": sq.get("id"),
                "q": (sq.get("question") or "")[:80],
                "must": (sq.get("must_find") or [])[:4],
                "cols": (sq.get("target_collections") or [])[:4],
            }
            for sq in (plan.get("evidence_subquestions") or [])[:5]
            if isinstance(sq, dict)
        ],
    }


def _deterministic_query_plan(question: str) -> dict:
    plan = _empty_query_plan(question)
    q = (question or "").lower()
    legal_terms: list[str] = []
    aspects: list[str] = []
    target_collections: list[str] = []
    title_must_terms: list[str] = []
    title_nice_terms: list[str] = []
    title_exclude_terms: list[str] = []
    for triggers, terms, rule_aspects in _QUERY_ALIAS_RULES:
        if any(trigger in q for trigger in triggers):
            legal_terms.extend(terms)
            aspects.extend(rule_aspects)
    title_queries: list[str] = []
    source_preferences: list[str] = []
    for triggers, titles, sources, rule_aspects in _QUERY_TITLE_RULES:
        if any(trigger in q for trigger in triggers):
            title_queries.extend(titles)
            source_preferences.extend(sources)
            aspects.extend(rule_aspects)
    for triggers, collections in _QUERY_COLLECTION_RULES:
        if any(trigger in q for trigger in triggers):
            target_collections.extend(collections)
    procedural_subquestions = _procedure_evidence_subquestions(question)
    if procedural_subquestions:
        for sq in procedural_subquestions:
            aspects.append(sq["question"])
            legal_terms.extend(sq.get("must_find", []))
            target_collections.extend(sq.get("target_collections", []))
            source_preferences.extend(sq.get("source_preferences", []))
    _semantic_cols, _semantic_prefs = _semantic_collection_hints(question, plan)
    target_collections.extend(_semantic_cols)
    source_preferences.extend(_semantic_prefs)
    for triggers, must_terms, nice_terms, exclude_terms in _QUERY_TITLE_CONSTRAINT_RULES:
        if any(trigger in q for trigger in triggers):
            title_must_terms.extend(must_terms)
            title_nice_terms.extend(nice_terms)
            title_exclude_terms.extend(exclude_terms)

    compare_markers = (" чи ", " або ", " vs ", " versus ", "краще", "лучше", "обрати", "выбрать", "порівня", "сравн")
    should_compare = any(marker in f" {q} " for marker in compare_markers)
    if should_compare:
        aspects.extend(("порівняння варіантів", "ризики вибору"))

    legal_terms = _merge_unique_strings(legal_terms, limit=18)
    aspects = _merge_unique_strings(aspects, limit=8)
    target_collections = _merge_unique_strings(target_collections, limit=8)
    title_must_terms = _merge_unique_strings(title_must_terms, limit=5)
    title_nice_terms = _merge_unique_strings(title_nice_terms, limit=6)
    title_exclude_terms = _merge_unique_strings(title_exclude_terms, limit=6)
    if legal_terms:
        plan["legal_terms"] = legal_terms
        plan["aspects"] = aspects
        plan["title_queries"] = _merge_unique_strings(title_queries, limit=8)
        plan["title_must_terms"] = title_must_terms
        plan["title_nice_terms"] = title_nice_terms
        plan["title_exclude_terms"] = title_exclude_terms
        plan["source_preferences"] = _merge_unique_strings(source_preferences, limit=6)
        plan["target_collections"] = target_collections
        plan["search_query"] = " ".join(_merge_unique_strings(_query_terms(question, limit=12), legal_terms, aspects, limit=28))[:350]
        plan["should_compare"] = should_compare
        plan["needs_clarification"] = should_compare
        if should_compare:
            plan["clarification_questions"] = [
                "Команда буде у штаті чи працюватиме з підрядниками?",
                "Який очікуваний річний оборот?",
                "Плануються інвестори або частки в бізнесі?",
            ]
    elif title_queries:
        plan["title_queries"] = _merge_unique_strings(title_queries, limit=8)
        plan["title_must_terms"] = title_must_terms
        plan["title_nice_terms"] = title_nice_terms
        plan["title_exclude_terms"] = title_exclude_terms
        plan["source_preferences"] = _merge_unique_strings(source_preferences, limit=6)
        plan["target_collections"] = target_collections
        plan["aspects"] = aspects
        plan["legal_terms"] = _merge_unique_strings(_query_terms(question, limit=10), limit=14)
        plan["search_query"] = " ".join(_merge_unique_strings(plan["legal_terms"], plan["aspects"], limit=24))[:350]
    elif target_collections:
        plan["target_collections"] = target_collections
        plan["title_must_terms"] = title_must_terms
        plan["title_nice_terms"] = title_nice_terms
        plan["title_exclude_terms"] = title_exclude_terms
        plan["legal_terms"] = _merge_unique_strings(_query_terms(question, limit=10), limit=14)
        plan["search_query"] = " ".join(plan["legal_terms"])[:350] or question[:350]
    if plan.get("aspects") and not plan.get("evidence_subquestions"):
        plan["evidence_subquestions"] = _clean_evidence_subquestions(procedural_subquestions, limit=5) or [
            {
                "id": f"aspect_{idx + 1}",
                "question": f"{question[:180]} {aspect}"[:220],
                "must_find": _query_terms(aspect, limit=6),
                "avoid_if_only": [],
                "target_collections": plan.get("target_collections", [])[:5],
                "source_preferences": plan.get("source_preferences", [])[:4],
            }
            for idx, aspect in enumerate(plan.get("aspects", [])[:5])
        ]
    return plan


def _merge_query_plans(base: dict, extra: dict, question: str) -> dict:
    merged = _empty_query_plan(question)
    base = base or _empty_query_plan(question)
    extra = extra or {}
    merged["search_query"] = extra.get("search_query") or base.get("search_query") or question[:350]
    merged["legal_terms"] = _merge_unique_strings(
        base.get("legal_terms", []),
        extra.get("legal_terms", []),
        limit=18,
    )
    merged["aspects"] = _merge_unique_strings(
        base.get("aspects", []),
        extra.get("aspects", []),
        limit=10,
    )
    merged["title_queries"] = _merge_unique_strings(
        extra.get("title_queries", []),
        base.get("title_queries", []),
        limit=8,
    )
    merged["title_must_terms"] = _merge_unique_strings(
        extra.get("title_must_terms", []),
        base.get("title_must_terms", []),
        limit=5,
    )
    merged["title_nice_terms"] = _merge_unique_strings(
        extra.get("title_nice_terms", []),
        base.get("title_nice_terms", []),
        limit=6,
    )
    merged["title_exclude_terms"] = _merge_unique_strings(
        extra.get("title_exclude_terms", []),
        base.get("title_exclude_terms", []),
        limit=6,
    )
    merged["primary_act_hints"] = _merge_unique_strings(
        extra.get("primary_act_hints", []),
        base.get("primary_act_hints", []),
        limit=5,
    )
    merged["source_preferences"] = _merge_unique_strings(
        extra.get("source_preferences", []),
        base.get("source_preferences", []),
        limit=6,
    )
    merged["target_collections"] = _clean_plan_collections(
        _merge_unique_strings(
            extra.get("target_collections", []),
            base.get("target_collections", []),
            limit=8,
        ),
        limit=8,
    )
    _subquestions: list[dict] = []
    _seen_subq: set[str] = set()
    for _sq in _clean_evidence_subquestions(extra.get("evidence_subquestions"), limit=5) + _clean_evidence_subquestions(base.get("evidence_subquestions"), limit=5):
        _sq_key = (_sq.get("question") or "").lower()
        if not _sq_key or _sq_key in _seen_subq:
            continue
        _seen_subq.add(_sq_key)
        _subquestions.append(_sq)
        if len(_subquestions) >= 5:
            break
    merged["evidence_subquestions"] = _subquestions
    merged["should_compare"] = bool(base.get("should_compare") or extra.get("should_compare"))
    merged["needs_clarification"] = bool(base.get("needs_clarification") or extra.get("needs_clarification"))
    merged["clarification_questions"] = _merge_unique_strings(
        extra.get("clarification_questions", []),
        base.get("clarification_questions", []),
        limit=3,
    )
    # article_hint comes only from AI plan (not deterministic), take extra's value
    merged["article_hint"] = extra.get("article_hint") or base.get("article_hint")
    merged["article_confidence"] = float(extra.get("article_confidence") or base.get("article_confidence") or 0.0)
    if merged["legal_terms"] and (not merged["search_query"] or merged["search_query"] == question[:350]):
        merged["search_query"] = " ".join(_merge_unique_strings(_query_terms(question, limit=12), merged["legal_terms"], merged["aspects"], limit=28))[:350]
    return merged


def _has_any_marker(text: str, markers: tuple[str, ...]) -> bool:
    return any(marker in text for marker in markers)


def _legal_query_profile(question: str, plan: dict | None = None) -> dict:
    """Small retrieval policy layer: roles, collection hints and fallback budgets."""
    q_base = (question or "").lower()
    text = " ".join([
        question or "",
        " ".join((plan or {}).get("legal_terms") or []),
        " ".join((plan or {}).get("aspects") or []),
        " ".join((plan or {}).get("title_queries") or []),
        " ".join((plan or {}).get("source_preferences") or []),
    ]).lower()

    tax_markers = (
        "фоп", "єсв", "єдиний внесок", "єдиного внеску", "єдиний подат", "єдиного податку",
        "податк", "пдв", "дпс", "зір", "спрощен", "3 груп", "третьої груп",
    )
    value_markers = (
        "скільки", "розмір", "сума", "ставка", "відсот", "процент", "ліміт", "обмежен",
        "мінімаль", "максималь", "платити", "сплачувати", "сплата", "термін", "строк",
        "2024", "2025", "2026", "зараз", "наразі", "поточн",
    )
    court_markers = (
        "суд", "судова практик", "верховн", "верховний суд", "постанова вс", " вс ", "касаційн", "позиці", "правова позиці",
        "оскарж", "постанова суд", "рішення суд",
    )
    official_markers = (
        "міністер", "мінобор", "дпс", "орган", "роз'яснен", "розяснен", "лист", "позиція орган",
        "порядок", "процедур", "як оформ", "як подати", "як отримати",
    )
    explanation_markers = (
        "простими словами", "поясни", "що означ", "що таке", "різниця", "порівняй",
        "переваги", "недоліки",
    )
    procedure_markers = (
        "як законно", "як правильно", "як оформ", "порядок", "процедур", "що зробити",
        "які кроки", "документи", "оформлення",
    )
    labor_markers = (
        "працівник", "роботодав", "звільн", "трудов", "кзпп", "профспіл",
        "заробітн", "відпустк", "скорочення",
    )

    is_tax = _has_any_marker(text, tax_markers)
    needs_exact_value = _has_any_marker(q_base, value_markers)
    is_court = _has_any_marker(text, court_markers)
    is_official = _has_any_marker(text, official_markers)
    wants_explanation = _has_any_marker(text, explanation_markers)
    is_procedure = _has_any_marker(text, procedure_markers)
    is_labor = _has_any_marker(text, labor_markers)

    collections: list[str] = []
    prefs: list[str] = []
    intent = "general_norm"
    keyword_limit = 12
    title_limit = 16
    max_aspects = 5
    carry_history_evidence = True

    if is_court:
        intent = "court_position"
        collections.extend(["laws_supreme_v2", "laws_positions_v2", "laws_ccu_v2", "rada_court_v2"])
        prefs.extend(["court", "rada"])
        keyword_limit = 10
        title_limit = 12
    elif is_tax:
        intent = "tax_or_business"
        collections.extend([
            "rada_finance_v2", "rada_labor_v2", "laws_zir_v2", "laws_kmu_v2",
            "laws_mod_v2", "laws_wiki_v2",
        ])
        prefs.extend(["rada", "zir", "kmu", "mod", "wiki"])
        keyword_limit = 10
        title_limit = 12
    elif is_labor:
        intent = "labor_procedure" if is_procedure else "labor_norm"
        collections.extend(["rada_labor_v2", "rada_civil_v2", "laws_positions_v2", "laws_wiki_v2"])
        prefs.extend(["rada", "court", "wiki"])
        keyword_limit = 10
        title_limit = 10
        max_aspects = 5 if is_procedure else 4
    elif is_official:
        intent = "official_procedure"
        collections.extend(["laws_kmu_v2", "laws_mod_v2", "rada_admin_v2", "rada_state_v2", "laws_wiki_v2"])
        prefs.extend(["kmu", "mod", "rada", "wiki"])
    elif is_procedure:
        intent = "legal_procedure"
        collections.extend(["rada_admin_v2", "laws_kmu_v2", "laws_mod_v2", "laws_wiki_v2"])
        prefs.extend(["rada", "kmu", "mod", "wiki"])
    elif wants_explanation:
        intent = "explanation"
        collections.extend(["laws_wiki_v2", "laws_zir_v2", "laws_kmu_v2"])
        prefs.extend(["wiki", "zir", "kmu", "rada"])

    if needs_exact_value:
        intent = f"{intent}_exact_value"
        max_aspects = 2
        keyword_limit = min(keyword_limit, 8)
        title_limit = min(title_limit, 8)
        carry_history_evidence = False

    return {
        "intent": intent,
        "needs_exact_value": needs_exact_value,
        "target_collections": _clean_plan_collections(collections, limit=8),
        "source_preferences": _clean_plan_list(prefs, limit=6, min_len=3, max_len=20),
        "max_aspects": max_aspects,
        "keyword_limit": keyword_limit,
        "title_limit": title_limit,
        "carry_history_evidence": carry_history_evidence,
    }


def _safe_followup_context(current_question: str, previous_question: str) -> str:
    """Carry only stable entities from the previous turn, not the whole topic."""
    current = (current_question or "").lower()
    previous = previous_question or ""
    prev_lower = previous.lower()
    carry: list[str] = []

    entity_patterns = (
        r"\bфоп\b(?:\s+\d\s*(?:груп[аиіїу]|гр\.?)?)?",
        r"\bтов\b",
        r"\bєсв\b",
        r"\bпдв\b",
        r"\bквед\b",
        r"\b\d\s*(?:груп[аиіїу]|гр\.?)\b",
        r"\b20\d{2}\b",
    )
    for pattern in entity_patterns:
        for match in re.finditer(pattern, prev_lower, flags=re.IGNORECASE):
            value = match.group(0).strip()
            if not value or value in carry or any(value in item or item in value for item in carry):
                continue
            if value in current or any(ch.isdigit() for ch in value) or len(value) <= 5:
                carry.append(value)
            elif value in {"фоп", "тов", "єсв", "пдв", "квед"}:
                carry.append(value)
            if len(carry) >= 5:
                break
        if len(carry) >= 5:
            break

    cur_terms = set(_query_terms(current_question, limit=18))
    for term in _query_terms(previous_question, limit=18):
        if term in cur_terms or term in {"фоп", "тов", "єсв", "пдв", "квед"}:
            if term not in carry and not any(term in item or item in term for item in carry):
                carry.append(term)
        if len(carry) >= 7:
            break

    if not carry:
        return ""
    return " ".join(dict.fromkeys(carry))[:160]


def _semantic_collection_hints(question: str, plan: dict | None = None) -> tuple[list[str], list[str]]:
    text = " ".join([
        question or "",
        " ".join((plan or {}).get("legal_terms") or []),
        " ".join((plan or {}).get("aspects") or []),
        " ".join((plan or {}).get("title_queries") or []),
    ]).lower()
    cols: list[str] = []
    prefs: list[str] = []
    profile = _legal_query_profile(question, plan)
    cols.extend(profile.get("target_collections", []))
    prefs.extend(profile.get("source_preferences", []))
    if any(t in text for t in ("влк", "військово-лікар", "відстроч", "мобілізац", "військовий облік", "тцк", "призов", "бронюван", "бронь", "військовозобов", "міноборони", "міністерство оборони", "зсу", "збройних сил", "оборон")):
        cols.extend(["rada_state_v2", "rada_other_v2", "laws_mod_v2", "laws_kmu_v2"])
        prefs.extend(["rada", "mod", "kmu"])
    if any(t in text for t in ("сільськогосподарськ", "земельн", "землі", "ділянк")) and any(t in text for t in ("продаж", "відчуж", "набувати", "право власності", "обіг земель")):
        cols.extend(["rada_land_v2", "rada_state_v2", "laws_kmu_v2"])
        prefs.extend(["rada", "kmu"])
    if any(t in text for t in ("впо", "внутрішньо переміщ", "працевлаштуван")) and any(t in text for t in ("компенсац", "роботодав", "витрат")):
        cols.extend(["laws_kmu_v2", "rada_labor_v2", "rada_finance_v2", "laws_zir_v2"])
        prefs.extend(["kmu", "rada", "zir"])
    if any(t in text for t in ("фоп", "тов", "дія сіті", "it", "іт", "айті", "команда")) and any(t in text for t in ("обрати", "вибір", "краще", "рекомендац", "реєстрац")):
        cols.extend(["rada_finance_v2", "rada_industry_v2", "rada_civil_v2", "laws_zir_v2", "laws_wiki_v2"])
        prefs.extend(["rada", "zir", "wiki"])
    return _clean_plan_collections(cols, limit=8), _clean_plan_list(prefs, limit=6, min_len=3, max_len=20)


def _normalize_query_plan(raw_plan, question: str) -> dict:
    plan = _empty_query_plan(question)
    if not isinstance(raw_plan, dict):
        return plan

    search_query = raw_plan.get("search_query")
    if isinstance(search_query, str):
        search_query = re.sub(r"\s+", " ", search_query).strip()
        if 8 <= len(search_query) <= 350:
            plan["search_query"] = search_query

    plan["legal_terms"] = _clean_plan_list(raw_plan.get("legal_terms"), limit=14, min_len=2)
    plan["aspects"] = _clean_plan_list(raw_plan.get("aspects"), limit=8, min_len=4)
    plan["title_queries"] = _clean_plan_list(raw_plan.get("title_queries"), limit=8, min_len=5)
    plan["title_must_terms"] = _clean_plan_list(raw_plan.get("title_must_terms"), limit=5, min_len=4, max_len=80)
    plan["title_nice_terms"] = _clean_plan_list(raw_plan.get("title_nice_terms"), limit=6, min_len=4, max_len=80)
    plan["title_exclude_terms"] = _clean_plan_list(raw_plan.get("title_exclude_terms"), limit=6, min_len=4, max_len=80)
    plan["primary_act_hints"] = _clean_plan_list(raw_plan.get("primary_act_hints"), limit=5, min_len=6)
    plan["source_preferences"] = _clean_plan_list(raw_plan.get("source_preferences"), limit=6, min_len=4)
    plan["target_collections"] = _clean_plan_collections(raw_plan.get("target_collections"), limit=8)
    plan["clarification_questions"] = _clean_plan_list(raw_plan.get("clarification_questions"), limit=3, min_len=8, max_len=180)
    plan["evidence_subquestions"] = _clean_evidence_subquestions(raw_plan.get("evidence_subquestions"), limit=5)
    plan["should_compare"] = bool(raw_plan.get("should_compare"))
    plan["needs_clarification"] = bool(raw_plan.get("needs_clarification"))
    _raw_hint = raw_plan.get("article_hint")
    if isinstance(_raw_hint, dict):
        _hint_law = str(_raw_hint.get("law_id") or "").strip()
        _hint_art = str(_raw_hint.get("article") or "").strip()
        if _hint_law and _hint_art:
            plan["article_hint"] = {"law_id": _hint_law, "article": _hint_art}
    _raw_conf = raw_plan.get("article_confidence")
    if isinstance(_raw_conf, (int, float)):
        plan["article_confidence"] = max(0.0, min(1.0, float(_raw_conf)))
    return plan


def _partial_json_string_value(raw: str, key: str) -> str | None:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*"([^"]*)', raw or "", re.DOTALL)
    if not match:
        return None
    return re.sub(r"\s+", " ", match.group(1)).strip()


def _partial_json_list_values(raw: str, key: str, *, limit: int, min_len: int = 2, max_len: int = 140) -> list[str]:
    match = re.search(rf'"{re.escape(key)}"\s*:\s*\[(.*?)(?:\]|$)', raw or "", re.DOTALL)
    if not match:
        return []
    values = re.findall(r'"([^"]+)"', match.group(1))
    return _clean_plan_list(values, limit=limit, min_len=min_len, max_len=max_len)


def _partial_evidence_subquestions(raw: str, *, limit: int = 5) -> list[dict]:
    match = re.search(r'"evidence_subquestions"\s*:\s*\[(.*?)(?:\]\s*,\s*"(?:should_compare|needs_clarification)|\]\s*\})', raw or "", re.DOTALL)
    if not match:
        return []
    block = match.group(1)
    items: list[dict] = []
    for obj in re.finditer(r"\{(.*?)\}", block, re.DOTALL):
        chunk = obj.group(1)
        question = _partial_json_string_value("{" + chunk + "}", "question")
        if not question:
            continue
        items.append({
            "id": _partial_json_string_value("{" + chunk + "}", "id") or f"q{len(items) + 1}",
            "question": question,
            "must_find": _partial_json_list_values("{" + chunk + "}", "must_find", limit=6, min_len=2, max_len=80),
            "avoid_if_only": _partial_json_list_values("{" + chunk + "}", "avoid_if_only", limit=5, min_len=3, max_len=80),
            "target_collections": _partial_json_list_values("{" + chunk + "}", "target_collections", limit=5, min_len=6, max_len=40),
            "source_preferences": _partial_json_list_values("{" + chunk + "}", "source_preferences", limit=4, min_len=3, max_len=20),
        })
        if len(items) >= limit:
            break
    return _clean_evidence_subquestions(items, limit=limit)


def _partial_query_plan(raw: str, question: str) -> dict:
    plan = _empty_query_plan(question)
    search_query = _partial_json_string_value(raw, "search_query")
    if search_query and 8 <= len(search_query) <= 350:
        plan["search_query"] = search_query
    plan["legal_terms"] = _partial_json_list_values(raw, "legal_terms", limit=14, min_len=2)
    plan["aspects"] = _partial_json_list_values(raw, "aspects", limit=8, min_len=4)
    plan["title_queries"] = _partial_json_list_values(raw, "title_queries", limit=8, min_len=5)
    plan["title_must_terms"] = _partial_json_list_values(raw, "title_must_terms", limit=5, min_len=4, max_len=80)
    plan["title_nice_terms"] = _partial_json_list_values(raw, "title_nice_terms", limit=6, min_len=4, max_len=80)
    plan["title_exclude_terms"] = _partial_json_list_values(raw, "title_exclude_terms", limit=6, min_len=4, max_len=80)
    plan["primary_act_hints"] = _partial_json_list_values(raw, "primary_act_hints", limit=5, min_len=6)
    plan["source_preferences"] = _partial_json_list_values(raw, "source_preferences", limit=6, min_len=3)
    plan["target_collections"] = _clean_plan_collections(
        _partial_json_list_values(raw, "target_collections", limit=8, min_len=6, max_len=40),
        limit=8,
    )
    plan["evidence_subquestions"] = _partial_evidence_subquestions(raw, limit=5)
    plan["clarification_questions"] = _partial_json_list_values(raw, "clarification_questions", limit=3, min_len=8, max_len=180)
    plan["should_compare"] = bool(re.search(r'"should_compare"\s*:\s*true', raw or "", re.I))
    plan["needs_clarification"] = bool(re.search(r'"needs_clarification"\s*:\s*true', raw or "", re.I))
    # article_hint from partial JSON: {"article_hint":{"law_id":"8073-10","article":"122"}}
    _ah_m = re.search(
        r'"article_hint"\s*:\s*\{[^}]*"law_id"\s*:\s*"([^"]+)"[^}]*"article"\s*:\s*"([^"]+)"',
        raw or "",
    )
    if not _ah_m:
        # also try reversed key order
        _ah_m = re.search(
            r'"article_hint"\s*:\s*\{[^}]*"article"\s*:\s*"([^"]+)"[^}]*"law_id"\s*:\s*"([^"]+)"',
            raw or "",
        )
        if _ah_m:
            _ah_art, _ah_law = _ah_m.group(1).strip(), _ah_m.group(2).strip()
        else:
            _ah_law = _ah_art = ""
    else:
        _ah_law, _ah_art = _ah_m.group(1).strip(), _ah_m.group(2).strip()
    if _ah_law and _ah_art:
        plan["article_hint"] = {"law_id": _ah_law, "article": _ah_art}
    _conf_m = re.search(r'"article_confidence"\s*:\s*([0-9.]+)', raw or "")
    if _conf_m:
        try:
            plan["article_confidence"] = max(0.0, min(1.0, float(_conf_m.group(1))))
        except ValueError:
            pass
    return plan


def _last_user_question(history: list[dict] | None) -> str:
    if not history:
        return ""
    for turn in reversed(history):
        if turn.get("role") == "user":
            content = (turn.get("content") or "").strip()
            if content:
                return content[:600]
    return ""


_HISTORY_EVIDENCE_MARKERS = (
    "підтвердж", "контекст", "фоп", "тов", "єдиний подат", "спрощен", "цпд",
    "найман", "ліміт", "дохід", "відповідальн", "управл", "статут", "реєстрац",
    "компенсац", "відстроч", "штраф", "строк", "право", "обов",
)


def _history_evidence_summary(history: list[dict] | None, *, limit_chars: int = 1400) -> dict:
    if not history:
        return {"text": "", "terms": []}
    snippets: list[str] = []
    seen: set[str] = set()
    assistant_turns = [
        (turn.get("content") or "").strip()
        for turn in history[-8:]
        if turn.get("role") == "assistant" and (turn.get("content") or "").strip()
    ]
    for content in assistant_turns[-3:]:
        for raw_line in re.split(r"[\n\r]+", content):
            line = re.sub(r"^\s*[-*•\d.)\s]+", "", raw_line).strip()
            if not line or len(line) < 35:
                continue
            lower = line.lower()
            if "[" not in line or "]" not in line:
                continue
            if not any(marker in lower for marker in _HISTORY_EVIDENCE_MARKERS):
                continue
            line = re.sub(r"\s+", " ", line)
            key = line[:180].lower()
            if key in seen:
                continue
            seen.add(key)
            snippets.append(line[:320])
            if len(" ".join(snippets)) >= limit_chars:
                break
        if len(" ".join(snippets)) >= limit_chars:
            break
    text = "\n".join(f"- {s}" for s in snippets)[:limit_chars]
    return {"text": text, "terms": _query_terms(" ".join(snippets), limit=28) if snippets else []}


def _looks_like_followup(text: str) -> bool:
    q = (text or "").strip().lower()
    if not q:
        return False
    words = re.findall(r"[\w'-]+", q)
    if len(words) <= 7:
        return True
    return any(marker in q for marker in (" це ", " цей ", " ця ", " ті ", " вони ", " так само", "а для "))


def _term_overlap_score(result: dict, terms: list[str]) -> int:
    meta = result.get("out_metadata", {})
    haystack = (
        (meta.get("source") or "") + " " +
        (meta.get("title") or "") + " " +
        (result.get("out_content") or "")
    ).lower()
    return sum(1 for term in terms if term in haystack)


def _parse_doc_date(value) -> datetime | None:
    if not value:
        return None
    raw = str(value).strip()
    if not raw or raw in {"—", "-", "None", "null"}:
        return None
    raw = raw.replace("Z", "+00:00")
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%Y%m%d"):
        try:
            return datetime.strptime(raw[:10], fmt).replace(tzinfo=timezone.utc)
        except Exception:
            pass
    try:
        dt = datetime.fromisoformat(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _doc_date_from_law_id(value) -> datetime | None:
    raw = str(value or "")
    if not raw:
        return None
    match = re.search(r"-(\d{4})(?:-|$)", raw)
    if match:
        year = int(match.group(1))
        if 1900 <= year <= datetime.now(timezone.utc).year:
            return datetime(year, 1, 1, tzinfo=timezone.utc)
    match = re.search(r"-(\d{2})(?:\D*$|$)", raw)
    if match:
        yy = int(match.group(1))
        year = 2000 + yy if yy <= 35 else 1900 + yy
        if 1900 <= year <= datetime.now(timezone.utc).year:
            return datetime(year, 1, 1, tzinfo=timezone.utc)
    return None


def _doc_best_date(result: dict) -> datetime | None:
    meta = result.get("out_metadata", {}) or {}
    for key in (
        "rada_last_edition",
        "effective_date",
        "date_adopted",
        "rada_adopted_date",
    ):
        dt = _parse_doc_date(meta.get(key))
        if dt and dt <= datetime.now(timezone.utc):
            return dt
    return _doc_date_from_law_id(meta.get("law_id") or meta.get("url") or meta.get("source"))


def _aspect_overlap_required(terms: list[str]) -> int:
    if len(terms) <= 2:
        return 1
    return min(3, max(2, len(terms) // 3))


def _aspect_overlap_ok(result: dict, terms: list[str]) -> bool:
    if not terms:
        return False
    overlap = _term_overlap_score(result, terms)
    if overlap < _aspect_overlap_required(terms):
        return False
    ans = result.get("_answerability") or _answerability_score(result, " ".join(terms), terms)
    return float(ans.get("content_coverage", 0.0) or 0.0) >= min(0.45, _aspect_overlap_required(terms) / max(len(terms), 1))


def _recency_score(result: dict) -> float:
    """Positive for fresh relevant law; negative for stale secondary material."""
    dt = _doc_best_date(result)
    if not dt:
        return -_stale_temporal_penalty(result)
    age_days = max(0, (datetime.now(timezone.utc) - dt).days)
    age_years = age_days / 365.25
    col = result.get("_collection", "")
    meta = result.get("out_metadata", {}) or {}
    doc_type = meta.get("rada_doc_type") or meta.get("doc_type", "")
    is_primary = col.startswith("rada_") or col == "laws_kmu_v2"
    is_code_or_law = doc_type in {"Кодекс", "Закон"}

    score = 0.0
    if age_years <= 1:
        score = 0.18 if is_primary else 0.12
    elif age_years <= 3:
        score = 0.12 if is_primary else 0.07
    elif age_years <= 7:
        score = 0.06 if is_primary else 0.02

    # Old primary codes/laws can still be current if last_edition is missing in old payloads.
    if score == 0.0 and not (is_primary and is_code_or_law and not meta.get("rada_is_dead")):
        if _is_court_collection(col):
            score = -0.16 if age_years >= 10 else -0.08
        elif col in {"laws_zir_v2", "laws_wiki_v2"}:
            score = -0.10 if age_years >= 7 else -0.04
        elif age_years >= 20:
            score = -0.18
        elif age_years >= 15:
            score = -0.10
        elif age_years >= 10:
            score = -0.05
    return score - _stale_temporal_penalty(result)


_UA_MONTHS = {
    "січня": 1, "января": 1,
    "лютого": 2, "февраля": 2,
    "березня": 3, "марта": 3,
    "квітня": 4, "апреля": 4,
    "травня": 5, "мая": 5,
    "червня": 6, "июня": 6,
    "липня": 7, "июля": 7,
    "серпня": 8, "августа": 8,
    "вересня": 9, "сентября": 9,
    "жовтня": 10, "октября": 10,
    "листопада": 11, "ноября": 11,
    "грудня": 12, "декабря": 12,
}


def _date_from_ua_phrase(day: str, month_name: str, year: str) -> datetime | None:
    month = _UA_MONTHS.get(month_name.lower())
    if not month:
        return None
    try:
        return datetime(int(year), month, int(day), tzinfo=timezone.utc)
    except Exception:
        return None


def _stale_temporal_penalty(result: dict) -> float:
    """Demote expired temporary fragments; never remove them from retrieval."""
    text = f"{result.get('out_content') or ''} {(result.get('out_metadata') or {}).get('source') or ''}".lower()
    if not text:
        return 0.0

    now = datetime.now(timezone.utc)
    penalty = 0.0
    temporal_markers = (
        "тимчасово", "на період", "карантин", "воєнного стану",
        "до припинення", "до скасування", "не пізніше ніж до",
    )
    if any(marker in text for marker in temporal_markers):
        penalty += 0.04

    for match in re.finditer(
        r"(?:до|не пізніше ніж до)\s+(\d{1,2})\s+([а-яіїєґ]+)\s+(\d{4})\s+року",
        text,
    ):
        dt = _date_from_ua_phrase(match.group(1), match.group(2), match.group(3))
        if dt and dt < now:
            penalty += 0.14
            break

    for match in re.finditer(r"(?:до|по)\s+(\d{1,2})[./](\d{1,2})[./](\d{4})", text):
        try:
            dt = datetime(int(match.group(3)), int(match.group(2)), int(match.group(1)), tzinfo=timezone.utc)
        except Exception:
            continue
        if dt < now:
            penalty += 0.14
            break

    return min(penalty, 0.24)


def _authority_score(result: dict) -> float:
    col = result.get("_collection", "")
    meta = result.get("out_metadata", {})
    doc_type = meta.get("rada_doc_type") or meta.get("doc_type", "")

    score = 1.0
    if col == "laws_kmu_v2":
        score = 1.18
    elif col.startswith("rada_"):
        score = 1.12
    elif col in ("laws_positions_v2", "laws_supreme_v2", "laws_ccu_v2"):
        score = 1.03
    elif col == "laws_zir_v2":
        score = 0.96
    elif col == "laws_wiki_v2":
        score = 0.90

    type_boost = {
        "Кодекс": 0.08,
        "Закон": 0.07,
        "Постанова": 0.06,
        "Наказ": 0.04,
        "Розпорядження": 0.03,
        "Лист": -0.08,
        "Роз'яснення": -0.05,
        "Інформаційний лист": -0.08,
    }.get(doc_type, 0.0)
    return score + type_boost


def _text_quality_score(text: str) -> float:
    """Cheap language/noise signal: penalize chunks where Cyrillic legal text is drowned by garbage."""
    letters = re.findall(r"[A-Za-zА-Яа-яІіЇїЄєҐґ]", text or "")
    if len(letters) < 80:
        return 0.85
    cyr = sum(1 for ch in letters if re.match(r"[А-Яа-яІіЇїЄєҐґ]", ch))
    ratio = cyr / max(len(letters), 1)
    if ratio >= 0.72:
        return 1.0
    if ratio >= 0.55:
        return 0.82
    return 0.55


def _directness_terms(terms: list[str]) -> list[str]:
    direct_terms: list[str] = []
    seen: set[str] = set()
    for term in terms:
        clean = (term or "").strip().lower()
        if not clean or clean in seen or clean in _QUERY_STOPWORDS:
            continue
        if clean in _LEGAL_ACRONYMS or any(ch.isdigit() for ch in clean) or len(clean) >= 6:
            seen.add(clean)
            direct_terms.append(clean)
        if len(direct_terms) >= 12:
            break
    return direct_terms


def _directness_score(content: str, terms: list[str]) -> float:
    direct_terms = _directness_terms(terms)
    if not direct_terms:
        return 0.0
    hits = sum(1 for term in direct_terms if term in (content or ""))
    return hits / max(len(direct_terms), 1)


def _directness_penalty(content: str, terms: list[str]) -> float:
    direct_terms = _directness_terms(terms)
    if len(direct_terms) < 4:
        return 0.0
    hits = sum(1 for term in direct_terms if term in (content or ""))
    if hits >= 2:
        return 0.0
    return 0.12 if hits == 1 else 0.20


def _result_avoid_topic_penalty(result: dict, avoid_terms: list[str], query_text: str) -> float:
    cleaned = [
        term.strip().lower()
        for term in avoid_terms
        if isinstance(term, str) and len(term.strip()) >= 3
    ]
    if not cleaned:
        return 0.0
    query = (query_text or "").lower()
    meta = result.get("out_metadata", {}) or {}
    title = f"{meta.get('source') or ''} {meta.get('title') or ''}".lower()
    content = (result.get("out_content") or "").lower()[:1800]
    haystack = f"{title} {content}"
    hits = [term for term in cleaned if term in haystack and term not in query]
    if not hits:
        return 0.0
    title_hits = [term for term in hits if term in title]
    return min(0.42, 0.14 * len(hits) + (0.08 if title_hits else 0.0))


def _apply_avoid_topic_penalties(results: list[dict], avoid_terms: list[str], query_text: str) -> None:
    if not results or not avoid_terms:
        return
    penalized: list[str] = []
    for r in results:
        penalty = _result_avoid_topic_penalty(r, avoid_terms, query_text)
        if penalty <= 0:
            continue
        r["_avoid_topic_penalty"] = max(float(r.get("_avoid_topic_penalty") or 0.0), penalty)
        r["similarity"] = max(0.0, float(r.get("similarity", 0.0) or 0.0) - penalty)
        meta = r.get("out_metadata", {}) or {}
        penalized.append(f"{r.get('_collection')}:{meta.get('law_id','?')}:p={penalty:.2f}")
    if penalized:
        logger.info("AVOID TOPIC PENALTY: %d chunks penalized by %s: %s", len(penalized), avoid_terms[:8], penalized[:10])


def _looks_like_amendatory_act(result: dict) -> bool:
    meta = result.get("out_metadata", {}) or {}
    title = f"{meta.get('source') or ''} {meta.get('title') or ''}".lower()
    return any(
        marker in title
        for marker in (
            "про внесення змін",
            "про внесення зміни",
            "про внесення змін і доповнень",
            "про внесення доповнень",
        )
    )


def _apply_article_hint_preference(results: list[dict], article_hint: dict | None, confidence: float) -> None:
    if not article_hint or confidence < 0.85:
        return
    hinted_law_id = str(article_hint.get("law_id") or "").strip()
    if not hinted_law_id:
        return
    adjusted: list[str] = []
    for r in results:
        meta = r.get("out_metadata", {}) or {}
        law_id = str(meta.get("law_id") or "")
        if r.get("_article_hint"):
            r["similarity"] = max(float(r.get("similarity", 0.0) or 0.0), 0.91)
            adjusted.append(f"+{r.get('_collection')}:{law_id}:{meta.get('chunk_index')}")
            continue
        if law_id != hinted_law_id and _looks_like_amendatory_act(r):
            penalty = 0.28
            r["_avoid_topic_penalty"] = max(float(r.get("_avoid_topic_penalty") or 0.0), penalty)
            r["similarity"] = max(0.0, float(r.get("similarity", 0.0) or 0.0) - penalty)
            adjusted.append(f"-{r.get('_collection')}:{law_id}:amendatory")
    if adjusted:
        logger.info("ARTICLE HINT PREFERENCE: adjusted %d chunks for %s: %s", len(adjusted), hinted_law_id, adjusted[:12])


_ARTICLE_ANSWER_MARKERS = (
    "штраф", "стягнен", "тягне", "тягнуть", "накладення", "неоподатковуван", "мінімум",
    "грив", "розмір", "ставк", "відсот", "компенсу", "надається", "виплачується",
    "має право", "не має права", "зобов", "повинен", "підляга", "не підляга",
    "заборон", "дозвол", "може", "не може", "строк", "термін", "протягом",
    "днів", "місяц", "рок", "умов", "порядок", "підстав", "пільг",
)


def _article_candidate_key(result: dict) -> tuple[str, str, int]:
    meta = result.get("out_metadata", {}) or {}
    return (str(result.get("_collection") or ""), str(meta.get("law_id") or ""), int(meta.get("chunk_index") or 0))


def _article_answer_window(candidates: list[dict], query_text: str, max_docs: int) -> list[dict]:
    if not candidates:
        return []
    ordered = sorted(
        candidates,
        key=lambda r: (
            str(r.get("_collection") or ""),
            str((r.get("out_metadata", {}) or {}).get("law_id") or ""),
            int((r.get("out_metadata", {}) or {}).get("chunk_index") or 0),
        ),
    )
    target = max(3, min(6, max_docs, len(ordered)))
    q_terms = _query_terms(query_text, limit=32)

    def score(result: dict) -> float:
        meta = result.get("out_metadata", {}) or {}
        content = (result.get("out_content") or "").lower()
        heading = f"{meta.get('source') or ''} {meta.get('title') or ''}".lower()
        content_hits = sum(1 for term in q_terms if term and term in content)
        heading_hits = sum(1 for term in q_terms if term and term in heading)
        marker_hits = sum(1 for marker in _ARTICLE_ANSWER_MARKERS if marker in content)
        answerability = float((result.get("_answerability") or {}).get("score", 0.0) or 0.0)
        return content_hits * 4.0 + heading_hits * 1.5 + marker_hits * 0.8 + answerability * 2.0

    ranked_positions = sorted(range(len(ordered)), key=lambda i: (-score(ordered[i]), i))
    selected: set[int] = set()
    for pos in ranked_positions:
        if score(ordered[pos]) <= 0 and selected:
            break
        for neighbor in (pos - 1, pos, pos + 1):
            if 0 <= neighbor < len(ordered):
                selected.add(neighbor)
        if len(selected) >= target:
            break
    if len(selected) < target:
        for pos in ranked_positions:
            selected.add(pos)
            if len(selected) >= target:
                break
    return [ordered[i] for i in sorted(selected)[:target]]


def _inject_article_hint_final(results: list[dict], candidates: list[dict], query_text: str, max_docs: int) -> list[dict]:
    if not candidates:
        return results
    article_window = _article_answer_window(candidates, query_text, max_docs)
    if not article_window:
        return results
    article_keys = {_article_candidate_key(r) for r in article_window}
    for r in article_window:
        r["similarity"] = max(float(r.get("similarity", 0.0) or 0.0), 0.91)
        if not r.get("_answerability"):
            r["_answerability"] = {
                "score": 0.91,
                "coverage": max(0.35, float(r.get("_answerability", {}).get("coverage", 0.0) or 0.0)),
                "content_coverage": max(0.25, float(r.get("_answerability", {}).get("content_coverage", 0.0) or 0.0)),
                "normative": True,
                "_article_proxy": True,
            }
    merged = article_window + results
    seen: set[tuple[str, str, int]] = set()
    deduped: list[dict] = []
    for r in merged:
        key = _article_candidate_key(r)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
        if len(deduped) >= max_docs:
            break
    logger.info(
        "ARTICLE FINAL GUARANTEE: candidates=%d window=%d moved_front=%d article_out=%d final=%d indices=%s",
        len(candidates),
        len(article_window),
        sum(1 for key in article_keys if key in {_article_candidate_key(r) for r in results}),
        sum(1 for r in deduped if r.get("_article_hint")),
        len(deduped),
        [(_article_candidate_key(r)[1], _article_candidate_key(r)[2]) for r in article_window],
    )
    return deduped


_QUERY_DOMAIN_GUARDS: tuple[tuple[str, tuple[str, ...], tuple[str, ...], tuple[str, ...]], ...] = (
    (
        "food_vs_energy",
        ("харч", "продукт", "корм", "безпечн", "фітосанітар", "ветеринар"),
        ("електричн", "електроенерг", "енергоринок", "електростанц", "енергетичн"),
        ("харч", "продукт", "корм", "безпечн", "фітосанітар", "ветеринар", "аграр", "сільськогосп"),
    ),
    (
        "food_vs_fuel",
        ("харч", "продукт", "корм", "безпечн"),
        ("палив", "нафт", "газ", "вугіл", "енергоресурс"),
        ("харч", "продукт", "корм", "безпечн", "аграр", "сільськогосп"),
    ),
    (
        "it_vs_agro",
        (" it ", " іт ", "айті", "програмуван", "інформаційні технолог"),
        ("фермер", "сільськогосп", "аграр", "земельн"),
        (" it ", " іт ", "айті", "програмуван", "інформаційні технолог", "дія сіті"),
    ),
)


def _result_domain_conflict_reason(query_text: str, result: dict) -> str | None:
    query = f" {(query_text or '').lower()} "
    meta = result.get("out_metadata", {}) or {}
    title = f"{meta.get('source') or ''} {meta.get('title') or ''}".lower()
    content = (result.get("out_content") or "").lower()[:1200]
    haystack = f" {title} {content} "
    for name, query_terms, negative_terms, rescue_terms in _QUERY_DOMAIN_GUARDS:
        if not any(term in query for term in query_terms):
            continue
        if not any(term in haystack for term in negative_terms):
            continue
        title_has_rescue = any(term in title for term in rescue_terms)
        content_has_rescue = any(term in content for term in rescue_terms)
        if not title_has_rescue and not content_has_rescue:
            return name
    return None


def _apply_domain_relevance_guard(results: list[dict], query_text: str) -> list[dict]:
    kept: list[dict] = []
    dropped: list[str] = []
    for r in results:
        reason = _result_domain_conflict_reason(query_text, r)
        if reason:
            meta = r.get("out_metadata", {}) or {}
            dropped.append(
                f"{r.get('_collection')}:{meta.get('law_id','?')}:{reason}:{(meta.get('source') or meta.get('title') or '')[:90]}"
            )
            continue
        kept.append(r)
    if dropped:
        logger.info("RELEVANCE GUARD: dropped %d domain-conflict chunks: %s", len(dropped), dropped[:8])
    return kept


def _answerability_score(result: dict, query_text: str, terms: list[str] | None = None) -> dict:
    """
    Universal deterministic reranker.

    Similarity only says "same topic"; answerability asks whether this chunk is likely to
    contain a usable legal answer to the exact question.
    """
    terms = terms or _query_terms(query_text, limit=18)
    meta = result.get("out_metadata", {})
    title = f"{meta.get('source') or ''} {meta.get('title') or ''}".lower()
    content = (result.get("out_content") or "").lower()
    haystack = f"{title} {content}"

    matched_terms = [t for t in terms if t in haystack]
    content_terms = [t for t in terms if t in content]
    title_terms = [t for t in terms if t in title]
    coverage = len(set(matched_terms)) / max(len(terms), 1)
    content_coverage = len(set(content_terms)) / max(len(terms), 1)

    normative_markers = (
        "зобов", "повинен", "повинн", "має право", "не має права",
        "підляга", "не підляга", "встановлю", "визнача", "передбач",
        "відповідно до", "згідно", "пункт", "статт", "частин",
        "закон", "постанова", "наказ", "порядок", "положення",
    )
    has_normative = any(marker in content for marker in normative_markers)

    col = result.get("_collection", "")
    source_penalty = 0.0
    if col == "laws_wiki_v2":
        source_penalty += 0.12
    elif col == "laws_supreme_v2":
        source_penalty += 0.06

    quality = _text_quality_score(result.get("out_content") or "")
    quality_penalty = (1.0 - quality) * 0.35
    directness = _directness_score(content, terms)
    directness_penalty = _directness_penalty(content, terms)

    sim = float(result.get("similarity", 0.0) or 0.0)
    score = (
        sim * 0.34
        + coverage * 0.34
        + content_coverage * 0.18
        + min(len(set(title_terms)), 3) * 0.025
        + (_authority_score(result) - 1.0) * 0.10
        + _recency_score(result) * 0.35
        + (0.06 if has_normative else 0.0)
        + directness * 0.16
        - source_penalty
        - quality_penalty
        - directness_penalty
        - float(result.get("_avoid_topic_penalty") or 0.0)
    )

    result["_answerability"] = {
        "score": round(score, 4),
        "coverage": round(coverage, 3),
        "content_coverage": round(content_coverage, 3),
        "matched": matched_terms[:10],
        "quality": round(quality, 3),
        "normative": has_normative,
        "recency": round(_recency_score(result), 3),
        "directness": round(directness, 3),
        "directness_penalty": round(directness_penalty, 3),
        "avoid_topic_penalty": round(float(result.get("_avoid_topic_penalty") or 0.0), 3),
    }
    return result["_answerability"]


def _is_background_collection(col: str) -> bool:
    return col in ("laws_wiki_v2", "laws_zir_v2")


def _is_court_collection(col: str) -> bool:
    # rada_court_v2 holds h22/h30/h1 documents (суд, судова практика, ГПК).
    # Active codes in it have a recent rada_last_edition → positive recency branch.
    # Old court-practice letters have no last_edition → fall to court penalty here.
    return col in ("laws_positions_v2", "laws_supreme_v2", "laws_ccu_v2", "rada_court_v2")


def _collection_matches_source_preference(col: str, prefs: list[str] | None) -> bool:
    pref_set = {str(p).strip().lower() for p in (prefs or []) if str(p).strip()}
    if not pref_set:
        return False
    if "rada" in pref_set and col.startswith("rada_"):
        return True
    if "kmu" in pref_set and col == "laws_kmu_v2":
        return True
    if "zir" in pref_set and col == "laws_zir_v2":
        return True
    if "wiki" in pref_set and col == "laws_wiki_v2":
        return True
    if "mod" in pref_set and col == "laws_mod_v2":
        return True
    if "court" in pref_set and col in {"laws_positions_v2", "laws_supreme_v2", "laws_ccu_v2", "rada_court_v2"}:
        return True
    return col.lower() in pref_set


def _collections_for_source_preferences(collections: list[str], prefs: list[str] | None) -> list[str]:
    if not prefs:
        return []
    picked = [col for col in collections if _collection_matches_source_preference(col, prefs)]
    return list(dict.fromkeys(picked))


def _is_primary_normative_act(result: dict) -> bool:
    col = result.get("_collection", "")
    meta = result.get("out_metadata", {}) or {}
    doc_type = meta.get("rada_doc_type") or meta.get("doc_type", "")
    if meta.get("rada_is_dead"):
        return False
    if col.startswith("rada_") and doc_type in {"Кодекс", "Закон"}:
        return True
    if col in {"laws_kmu_v2", "laws_mod_v2"} and doc_type in {"Постанова", "Наказ", "Розпорядження"}:
        return True
    return False


def _primary_act_score(result: dict, query_text: str, terms: list[str] | None = None) -> float:
    if not _is_primary_normative_act(result):
        return 0.0
    terms = terms or _query_terms(query_text, limit=18)
    meta = result.get("out_metadata", {}) or {}
    title = f"{meta.get('source') or ''} {meta.get('title') or ''}".lower()
    content = (result.get("out_content") or "").lower()
    title_hits = sum(1 for term in terms if term in title)
    content_hits = sum(1 for term in terms if term in content)
    title_density = min(title_hits, 5) * 0.11
    content_density = min(content_hits, 6) * 0.035
    directness = _directness_score(content, terms)
    score = (
        float(result.get("similarity", 0.0) or 0.0) * 0.42
        + (_authority_score(result) - 1.0) * 0.75
        + title_density
        + content_density
        + directness * 0.14
        + max(_recency_score(result), 0.0) * 0.45
        - _directness_penalty(content, terms) * 0.65
    )
    if result.get("_title_match"):
        score += 0.10
    if result.get("_doc_expansion"):
        score += 0.04
    return score


def _is_must_have_primary_act(result: dict) -> bool:
    return bool(result.get("_primary_act_candidate") or result.get("_primary_act_expansion"))


def _strict_context_score(result: dict, query_text: str, terms: list[str] | None = None) -> float:
    ans = result.get("_answerability") or _answerability_score(result, query_text, terms)
    col = result.get("_collection", "")
    score = float(ans.get("score", 0.0) or 0.0)
    score += (float(ans.get("content_coverage", 0.0) or 0.0) * 0.16)
    score += ((_authority_score(result) - 1.0) * 0.18)
    score += _recency_score(result) * 0.40
    if ans.get("normative"):
        score += 0.05
    if _is_background_collection(col):
        score -= 0.10
    if col == "laws_supreme_v2":
        score -= 0.04
    if _is_must_have_primary_act(result):
        score += 0.42
    score -= float(result.get("_avoid_topic_penalty") or 0.0)
    if (result.get("out_metadata") or {}).get("rada_is_dead"):
        score -= 0.40
    return score


def _squeeze_context_results(
    results: list[dict],
    query_text: str,
    max_docs: int,
    response_length_pref: str,
    *,
    keep_weak: bool = False,
) -> list[dict]:
    """Wide search stays wide; this makes the final Gemini context small and source-strict."""
    if not results:
        return []

    terms = _query_terms(query_text, limit=18)
    target_by_pref = {
        "short": 6,
        "standard": 8,
        "detailed": 10,
        "full": 12,
    }
    target = min(max_docs, target_by_pref.get(response_length_pref, 8))
    min_cov = 0.10 if keep_weak else 0.18

    scored: list[tuple[float, dict]] = []
    for r in results:
        ans = r.get("_answerability") or _answerability_score(r, query_text, terms)
        protected = bool(
            r.get("_full_law") or r.get("_doc_expansion")
            or r.get("_article_hint") or r.get("_evidence_coverage")
            or _is_must_have_primary_act(r) or r.get("_aspect_coverage")
        )
        if not protected and float(ans.get("coverage", 0.0) or 0.0) < min_cov:
            continue
        scored.append((_strict_context_score(r, query_text, terms), r))

    if not scored:
        scored = [(_strict_context_score(r, query_text, terms), r) for r in results]

    scored.sort(
        key=lambda item: (
            item[0],
            float(item[1].get("_answerability", {}).get("coverage", 0.0) or 0.0),
            _authority_score(item[1]),
            item[1].get("similarity", 0.0),
        ),
        reverse=True,
    )

    picked: list[dict] = []
    per_doc: dict[tuple[str, str], int] = {}
    col_counts: dict[str, int] = {}
    wiki_count = 0
    zir_count = 0
    positions_count = 0
    court_count = 0
    wiki_cap = 1
    # ZIR — офіційна позиція ДПС (Q&A формат, авторитетне джерело).
    zir_cap = 2
    # Positions — правові позиції ВС (12 800 Q&A по категоріях справ, авторитетне джерело).
    # Окремий cap бо positions і supreme/CCU — принципово різні джерела і не повинні витісняти одне одного.
    positions_cap = 2
    # Supreme + CCU + rada_court — судова практика і рішення КСУ.
    court_cap = max(1, min(2, target // 4))
    # Будь-яка одна regular-колекція займає не більше половини слотів.
    # target//3 виявилось занадто жорстким: вузькотематичні запити (напр. КУпАП)
    # потребують 4-5 чанків з однієї колекції — при cap=2 squeeze видає out=4 замість target=8.
    regular_col_cap = max(2, target // 2)

    # Evidence/aspect-protected docs get first pick — they were selected for distinct
    # query needs and must not be crowded out by other high-scoring docs.
    _aspect_items = [(s, r) for s, r in scored if r.get("_evidence_coverage") or r.get("_aspect_coverage")]
    _regular_items = [(s, r) for s, r in scored if not (r.get("_evidence_coverage") or r.get("_aspect_coverage"))]

    def _col_bucket(col: str) -> str:
        if col == "laws_zir_v2":
            return "zir"
        if col == "laws_wiki_v2":
            return "wiki"
        if col == "laws_positions_v2":
            return "positions"
        if _is_court_collection(col):  # supreme, CCU, rada_court
            return "court"
        return "regular"

    def _inc_bucket(bucket: str, col: str) -> None:
        nonlocal wiki_count, zir_count, positions_count, court_count
        if bucket == "zir":
            zir_count += 1
        elif bucket == "wiki":
            wiki_count += 1
        elif bucket == "positions":
            positions_count += 1
        elif bucket == "court":
            court_count += 1
        else:
            col_counts[col] = col_counts.get(col, 0) + 1

    for _score, r in _aspect_items:
        if len(picked) >= target:
            break
        col = r.get("_collection", "")
        doc_key = (col, r["out_metadata"].get("law_id", ""))
        if per_doc.get(doc_key, 0) >= 3:
            continue
        picked.append(r)
        per_doc[doc_key] = per_doc.get(doc_key, 0) + 1
        _inc_bucket(_col_bucket(col), col)

    for _score, r in _regular_items:
        if len(picked) >= target:
            break
        col = r.get("_collection", "")
        bucket = _col_bucket(col)
        if bucket == "zir" and zir_count >= zir_cap:
            continue
        if bucket == "wiki" and wiki_count >= wiki_cap:
            continue
        if bucket == "positions" and positions_count >= positions_cap:
            continue
        if bucket == "court" and court_count >= court_cap:
            continue
        if bucket == "regular" and col_counts.get(col, 0) >= regular_col_cap:
            continue
        doc_key = (col, r["out_metadata"].get("law_id", ""))
        doc_cap = 6 if r.get("_article_hint") else (4 if _is_must_have_primary_act(r) else (3 if r.get("_full_law") else 1))
        if per_doc.get(doc_key, 0) >= doc_cap:
            continue
        picked.append(r)
        per_doc[doc_key] = per_doc.get(doc_key, 0) + 1
        _inc_bucket(bucket, col)

    if len(picked) < min(target, 4):
        picked_keys = {
            (r.get("_collection", ""), r["out_metadata"].get("law_id", ""), r["out_metadata"].get("chunk_index"))
            for r in picked
        }
        for _score, r in scored:
            key = (r.get("_collection", ""), r["out_metadata"].get("law_id", ""), r["out_metadata"].get("chunk_index"))
            if key in picked_keys:
                continue
            picked.append(r)
            picked_keys.add(key)
            if len(picked) >= min(target, 4):
                break

    counts: dict[str, int] = {}
    for r in picked:
        counts[r.get("_collection", "?")] = counts.get(r.get("_collection", "?"), 0) + 1
    logger.info(
        "CONTEXT SQUEEZE: in=%d out=%d target=%d cols=%s top=%s",
        len(results),
        len(picked),
        target,
        dict(sorted(counts.items())),
        [
            f"{r.get('_collection')}:{r['out_metadata'].get('law_id','?')}:s={_strict_context_score(r, query_text, terms):.3f}:a={r.get('_answerability',{}).get('score')}:cov={r.get('_answerability',{}).get('coverage')}:rec={_recency_score(r):.2f}"
            for r in picked[:6]
        ],
    )
    return picked


def _source_role_for_result(result: dict) -> str:
    col = result.get("_collection", "")
    if col == "rada_court_v2":
        return "court_practice"
    if col.startswith("rada_") or col == "laws_kmu_v2":
        return "primary_norm"
    if col == "laws_mod_v2":
        return "official_norm"
    if col == "laws_zir_v2":
        return "tax_consultation"
    if col in {"laws_supreme_v2", "laws_ccu_v2", "laws_positions_v2"}:
        return "court_practice"
    if col == "laws_wiki_v2":
        return "explanation"
    return "other"


def _query_requires_exact_evidence(query_text: str) -> bool:
    return bool(_legal_query_profile(query_text).get("needs_exact_value"))


def _result_has_exact_value_evidence(result: dict) -> bool:
    content = (result.get("out_content") or "").lower()
    title = " ".join(str((result.get("out_metadata") or {}).get(k) or "") for k in ("source", "title", "rada_title")).lower()
    haystack = f"{title} {content[:2500]}"
    value_markers = (
        "грн", "%", "відсот", "процент", "ставка", "розмір", "сума", "ліміт",
        "мінімаль", "максималь", "заробітн", "прожитков", "сплач", "плат",
        "строк", "термін", "2024", "2025", "2026",
    )
    return bool(re.search(r"\d", haystack)) and any(marker in haystack for marker in value_markers)


def _build_evidence_brief(results: list[dict], query_text: str) -> tuple[str, dict]:
    """
    Deterministic, conservative guide for Gemini.

    It does not replace retrieval. It labels the already selected context so the
    answer can be practical and human without treating every retrieved chunk as
    equally authoritative.
    """
    if not results:
        return (
            "Evidence metadata:\n"
            "- context_state: absent.\n"
            "- primary_sources: none.\n\n",
            {"state": "absent", "usable": [], "background": [], "not_basis": []},
        )

    q = query_text.lower()
    terms = _query_terms(query_text, limit=18)
    usable: list[str] = []
    background: list[str] = []
    not_basis: list[str] = []
    reasons: dict[int, str] = {}
    requires_exact = _query_requires_exact_evidence(query_text)
    exact_usable: list[str] = []

    def _title(meta: dict) -> str:
        return str(meta.get("rada_title") or meta.get("source") or meta.get("title") or "")[:120]

    def _domain_conflict(meta: dict, content: str) -> str | None:
        titleish = f"{meta.get('source','')} {meta.get('rada_title','')} {meta.get('category','')} {meta.get('rada_theme','')}".lower()
        hay = f"{titleish} {content[:1200]}".lower()
        query_terms = set(_query_terms(query_text, limit=24))
        broad_terms = {
            "питання", "порядок", "держав", "підтрим", "фінансов", "компенсац",
            "витрат", "кошт", "підприєм", "суб'єкт", "отрим", "може", "закон",
            "україн", "період", "воєнн", "стан", "послуг", "робіт",
        }
        distinctive_query_terms = {t for t in query_terms if len(t) >= 5 and not any(t.startswith(b) for b in broad_terms)}

        special_scope_markers = (
            "у сфері ",
            "для підприємств",
            "перелік підприємств",
            "окремих підприємств",
            "для використання як",
            "для виробництва у",
            "щодо уповноваженої особи",
        )
        has_special_scope = any(marker in hay for marker in special_scope_markers)
        if has_special_scope and distinctive_query_terms:
            title_terms = set(_query_terms(titleish, limit=24))
            if not (distinctive_query_terms & title_terms):
                return "спеціальна сфера документа не збігається з питанням"
        return None

    for idx, r in enumerate(results, 1):
        meta = r.get("out_metadata", {}) or {}
        content = r.get("out_content") or ""
        role = _source_role_for_result(r)
        ans = r.get("_answerability") or _answerability_score(r, query_text, terms)
        score = float(ans.get("score", 0.0) or 0.0)
        cov = float(ans.get("coverage", 0.0) or 0.0)
        direct = float(ans.get("directness", 0.0) or 0.0)
        dead = bool(meta.get("rada_is_dead")) or "втратив" in str(meta.get("status", "")).lower()
        conflict = _domain_conflict(meta, content)
        protected = bool(
            r.get("_full_law") or r.get("_article_hint") or r.get("_protected_code")
            or _is_must_have_primary_act(r)
        )

        label = f"[{idx}] {_title(meta)}"
        has_exact = _result_has_exact_value_evidence(r)
        if dead:
            not_basis.append(label)
            reasons[idx] = "документ нечинний/втратив чинність"
        elif conflict:
            not_basis.append(label)
            reasons[idx] = conflict
        elif protected or role == "primary_norm" and (score >= 0.48 or cov >= 0.25):
            usable.append(label)
            if has_exact:
                exact_usable.append(label)
            reasons[idx] = "можна використовувати як основу"
        elif requires_exact and role in {"official_norm", "tax_consultation"} and has_exact and (score >= 0.42 or direct >= 0.18):
            usable.append(label)
            exact_usable.append(label)
            reasons[idx] = "містить прямі числові/строкові дані для відповіді"
        elif role in {"tax_consultation", "court_practice"} and (score >= 0.45 or direct >= 0.20):
            background.append(label)
            reasons[idx] = "допоміжне джерело, не замінює норму"
        elif role == "explanation":
            background.append(label)
            reasons[idx] = "пояснювальне джерело"
        elif score >= 0.55:
            usable.append(label)
            reasons[idx] = "прямо релевантний фрагмент"
        else:
            not_basis.append(label)
            reasons[idx] = "слабко відповідає на питання"

    if requires_exact and usable and not exact_usable:
        background = usable[:2] + background
        usable = []
        reasons[-1] = "для питання про суму/ставку/строк не знайдено прямого числового підтвердження"

    state = "sufficient" if usable else ("partial" if background else "absent")
    lines = [
        "Evidence metadata:",
        f"- context_state: {state}.",
    ]
    if usable:
        lines.append("- primary_sources: " + "; ".join(usable[:6]) + ".")
    if background:
        lines.append("- background_sources: " + "; ".join(background[:4]) + ".")
    if not_basis:
        lines.append("- limited_sources: " + "; ".join(not_basis[:5]) + ".")
    lines.append("")
    return "\n".join(lines) + "\n", {
        "state": state,
        "usable": usable,
        "background": background,
        "not_basis": not_basis,
        "reasons": reasons,
    }


def _filter_answer_context_sources(results: list[dict], query_text: str) -> list[dict]:
    if not results:
        return []

    terms = _query_terms(query_text, limit=18)
    q = query_text.lower()
    court_query = any(t in q for t in ("суд", "практик", "позиці", "позици", "верховн", "ксу", "оскарж"))
    tax_query = any(t in q for t in ("подат", "єдиний", "фоп", "пдв", "дпс", "зір"))
    exact_query = _query_requires_exact_evidence(query_text)
    primary_available = any(_source_role_for_result(r) in {"primary_norm", "official_norm"} for r in results)

    kept: list[dict] = []
    has_primary = False

    for r in results:
        role = _source_role_for_result(r)
        ans = r.get("_answerability") or _answerability_score(r, query_text, terms)
        score = float(ans.get("score", 0.0) or 0.0)
        cov = float(ans.get("coverage", 0.0) or 0.0)
        direct = float(ans.get("directness", 0.0) or 0.0)
        protected = bool(
            r.get("_full_law") or r.get("_doc_expansion") or r.get("_article_hint")
            or r.get("_evidence_coverage") or _is_must_have_primary_act(r) or r.get("_protected_code")
        )
        has_exact = _result_has_exact_value_evidence(r)

        keep = False
        if protected:
            keep = True
        elif exact_query and role in {"primary_norm", "official_norm", "tax_consultation"} and has_exact and (score >= 0.38 or cov >= 0.16 or direct >= 0.14):
            keep = True
        elif exact_query and role in {"court_practice", "explanation"}:
            keep = False
        elif role in {"primary_norm", "official_norm"} and (score >= 0.42 or cov >= 0.22 or direct >= 0.18):
            keep = True
        elif role == "tax_consultation" and (tax_query or not primary_available) and (score >= 0.52 or direct >= 0.25):
            keep = True
        elif role == "court_practice" and court_query and (score >= 0.55 or direct >= 0.30):
            keep = True
        elif role == "explanation" and not primary_available and score >= 0.62:
            keep = True

        if keep:
            kept.append(r)
            if role in {"primary_norm", "official_norm"}:
                has_primary = True
    if kept:
        return kept
    return results[: max(1, min(len(results), 4))]


def _rerank_by_answerability(results: list[dict], query_text: str, max_docs: int, *, keep_weak: bool = False) -> list[dict]:
    terms = _query_terms(query_text, limit=18)
    if len(terms) < 2 or not results:
        return results[:max_docs]

    scored: list[tuple[float, dict]] = []
    for r in results:
        ans = _answerability_score(r, query_text, terms)
        coverage = ans["coverage"]
        # Keep low-coverage chunks only when they are protected structural chunks
        # from a selected document, or when we are in weak-search mode and need
        # Gemini to explain what was found.
        protected = bool(
            r.get("_full_law") or r.get("_doc_expansion") or r.get("_article_hint")
            or r.get("_evidence_coverage") or _is_must_have_primary_act(r)
        )
        if not keep_weak and coverage < 0.12 and not protected:
            continue
        scored.append((ans["score"], r))

    if not scored:
        return results[:max_docs]

    scored.sort(
        key=lambda item: (
            item[0],
            item[1]["_answerability"]["coverage"],
            _authority_score(item[1]),
            item[1].get("similarity", 0.0),
        ),
        reverse=True,
    )

    picked: list[dict] = []
    per_doc: dict[tuple[str, str], int] = {}
    wiki_count = 0
    for _, r in scored:
        col = r.get("_collection", "")
        if col == "laws_wiki_v2":
            if wiki_count >= max(1, max_docs // 5):
                continue
            wiki_count += 1
        doc_key = (col, r["out_metadata"].get("law_id", ""))
        doc_cap = 6 if r.get("_article_hint") else (4 if r.get("_full_law") else 2)
        if per_doc.get(doc_key, 0) >= doc_cap:
            continue
        picked.append(r)
        per_doc[doc_key] = per_doc.get(doc_key, 0) + 1
        if len(picked) >= max_docs:
            break

    logger.info(
        "ANSWERABILITY RERANK: in=%d out=%d top=%s terms=%s",
        len(results),
        len(picked),
        [
            f"{r.get('_collection')}:{r['out_metadata'].get('law_id','?')}:a={r.get('_answerability',{}).get('score')}:cov={r.get('_answerability',{}).get('coverage')}"
            for r in picked[:6]
        ],
        terms[:10],
    )
    return picked or results[:max_docs]


def _prefer_term_matched_results(results: list[dict], query_text: str, max_docs: int) -> list[dict]:
    terms = _query_terms(query_text)
    if len(terms) < 2:
        return results[:max_docs]

    scored = [(_term_overlap_score(r, terms), r) for r in results]
    matched = [(score, r) for score, r in scored if score > 0]
    if len(matched) < 2:
        return results[:max_docs]

    matched.sort(
        key=lambda item: (
            item[0],
            _authority_score(item[1]),
            item[1].get("similarity", 0.0),
        ),
        reverse=True,
    )
    matched_rows = [r for _, r in matched]
    matched_keys = {
        (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index"))
        for r in matched_rows
    }
    remainder = [
        r for _, r in scored
        if (r["out_metadata"].get("law_id"), r["out_metadata"].get("chunk_index")) not in matched_keys
    ]
    reranked = (matched_rows + remainder)[:max_docs]
    logger.info(
        "TERM RERANK: matched=%d total=%d terms=%s",
        len(matched_rows),
        len(reranked),
        terms[:10],
    )
    return reranked


def _citations_used_in_answer(answer: str, citations: list[dict]) -> list[dict]:
    used: set[int] = set()
    for group in re.findall(r"\[([\d,\s]+)\]", answer or ""):
        used.update(int(n) for n in re.findall(r"\d+", group))
    if not used:
        return citations
    filtered = [c for c in citations if int(c.get("num", 0) or 0) in used]
    return filtered or citations


def _finish_reason_is_max_tokens(finish_reason) -> bool:
    return str(finish_reason) in ("FinishReason.MAX_TOKENS", "MAX_TOKENS", "2")


ANSWER_DONE_MARKER = "URAI_DONE"
_ANSWER_DONE_MARKER_TAIL = len(ANSWER_DONE_MARKER) + 8
ANSWER_CONTINUATION_MAX_ATTEMPTS = 6
ANSWER_CONTINUATION_TOKENS = 900
ANSWER_CONTINUATION_TIMEOUT = 25


def _answer_has_done_marker(answer: str) -> bool:
    return ANSWER_DONE_MARKER in (answer or "")


def _strip_answer_done_marker(answer: str) -> str:
    text = answer or ""
    if ANSWER_DONE_MARKER in text:
        before, _, _after = text.partition(ANSWER_DONE_MARKER)
        text = before

    # Streaming may end after a partial completion marker (for example "URAI").
    # Treat marker prefixes at the very end as transport artifacts, not answer text.
    stripped = text.rstrip()
    for n in range(len(ANSWER_DONE_MARKER) - 1, 3, -1):
        prefix = ANSWER_DONE_MARKER[:n]
        if stripped.endswith(prefix):
            stripped = stripped[: -len(prefix)].rstrip()
            break
    return stripped.strip()


def _deduplicate_answer_lines(answer: str) -> str:
    """Collapse consecutive duplicate lines — fixes Gemini repetition-loop artifacts."""
    if not answer:
        return answer
    lines = answer.split("\n")
    if len(lines) < 3:
        return answer
    result: list[str] = []
    prev_stripped: str | None = None
    for line in lines:
        stripped = line.strip()
        if stripped and stripped == prev_stripped:
            continue
        result.append(line)
        if stripped:
            prev_stripped = stripped
    return "\n".join(result)


def _answer_looks_incomplete(answer: str) -> bool:
    text = (answer or "").strip()
    if len(text) < 20:
        return False
    if _answer_has_done_marker(text):
        text = _strip_answer_done_marker(text)
    if len(text) < 20:
        return True
    if text[-1] in ".!?…]»)\"'":
        return False
    tail = text[-80:].lower()
    dangling_words = (
        " та", " і", " або", " але", " якщо", " що", " який", " яка", " які",
        " на", " у", " в", " до", " від", " за", " про", " при", " для", " щодо",
    )
    if any(tail.endswith(w) for w in dangling_words):
        return True
    if re.search(r"[,;:–—(\[]\s*$", text):
        return True
    return False


def _build_answer_continuation_prompt(completed: str) -> str:
    return (
        "Попередня відповідь була обрізана. "
        "Допиши ТІЛЬКИ продовження з місця обриву. Не повторюй уже написаний текст, не починай заново. "
        "Не пиши службові фрази на кшталт «доповнюю відповідь», «продовження» або «ось завершення». "
        "Заверши поточний пункт або речення максимально коротко і природно. "
        "Не додавай нові великі розділи. "
        f"Якщо можеш, закінчи фінальним рядком {ANSWER_DONE_MARKER}, але головне — завершити речення. "
        "Якщо останнє слово обрізане, почни з решти цього слова. "
        "Якщо потрібне юридичне посилання, збережи формат посилань із попередньої відповіді.\n\n"
        "Поточний кінець відповіді:\n"
        f"{completed[-2500:]}"
    )


def _append_answer_continuation(completed: str, continuation: str) -> str:
    continuation = (continuation or "").strip()
    if not continuation:
        return completed
    joiner = "" if completed.rstrip() and completed.rstrip()[-1].isalnum() and continuation[0].isalnum() else " "
    return completed.rstrip() + joiner + continuation


async def _complete_answer_if_needed(pipe: dict, answer: str, finish_reason=None) -> str:
    if not (_finish_reason_is_max_tokens(finish_reason) or _answer_looks_incomplete(answer)):
        return answer

    import asyncio as _asyncio
    from vertexai.generative_models import GenerationConfig

    completed = answer
    try:
        for attempt in range(ANSWER_CONTINUATION_MAX_ATTEMPTS):
            continuation_prompt = _build_answer_continuation_prompt(completed)
            cfg = GenerationConfig(temperature=0.0, max_output_tokens=ANSWER_CONTINUATION_TOKENS)
            resp = await _asyncio.wait_for(
                _asyncio.to_thread(pipe["main_model"].generate_content, continuation_prompt, generation_config=cfg),
                timeout=ANSWER_CONTINUATION_TIMEOUT,
            )
            continuation = (resp.text or "").strip()
            if not continuation:
                break
            completed = _append_answer_continuation(completed, continuation)
            logger.info("ANSWER CONTINUATION: attempt=%d appended %d chars", attempt + 1, len(continuation))
            cont_finish_reason = None
            try:
                cont_finish_reason = resp.candidates[0].finish_reason
            except Exception:
                pass
            if not (_finish_reason_is_max_tokens(cont_finish_reason) or _answer_looks_incomplete(completed)):
                break
        return completed
    except Exception as e:
        logger.warning("ANSWER CONTINUATION failed: %s", e)
    return completed

__all__ = [name for name in globals() if name.startswith("_") or name.startswith("ANSWER")]
