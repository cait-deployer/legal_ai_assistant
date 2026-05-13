"""
Source-role reranking for legal RAG.

This module is intentionally policy-based, not case-based. It does not know
answers to user questions; it only estimates the legal role of each retrieved
document and adds a small, explainable ranking signal.
"""

from __future__ import annotations

from enum import Enum
import re
from typing import Any


class SourceRole(str, Enum):
    BASE_CODE = "base_code"
    PRIMARY_LAW = "primary_law"
    AMENDING_ACT = "amending_act"
    BYLAW = "bylaw"
    ADMIN_PROCEDURE = "admin_procedure"
    TAX_EXPLANATION = "tax_explanation"
    COURT_PRACTICE = "court_practice"
    LEGAL_EXPLAINER = "legal_explainer"
    OTHER = "other"


_COURT_COLLECTIONS = {"laws_positions_v2", "laws_supreme_v2", "laws_ccu_v2", "rada_court_v2"}
_BYLAW_COLLECTIONS = {"laws_kmu_v2", "laws_mod_v2"}


def _meta_text(result: dict[str, Any]) -> str:
    meta = result.get("out_metadata", {}) or {}
    return " ".join(
        str(meta.get(key) or "")
        for key in (
            "source",
            "title",
            "rada_title",
            "doc_type",
            "rada_doc_type",
            "category",
            "rada_theme",
            "source_domain",
            "law_url",
        )
    ).lower()


def infer_source_role(result: dict[str, Any]) -> SourceRole:
    """Infer source role from collection + metadata, not from a concrete question."""
    col = str(result.get("_collection") or "")
    meta = result.get("out_metadata", {}) or {}
    text = _meta_text(result)

    if col in _COURT_COLLECTIONS:
        return SourceRole.COURT_PRACTICE
    if col == "laws_zir_v2":
        return SourceRole.TAX_EXPLANATION
    if col == "laws_wiki_v2":
        return SourceRole.LEGAL_EXPLAINER

    if any(marker in text for marker in ("про внесення змін", "про внесення зміни", "про внесення доповн")):
        return SourceRole.AMENDING_ACT

    doc_type = str(meta.get("rada_doc_type") or meta.get("doc_type") or "").lower()
    if "кодекс" in text or "кодекс" in doc_type:
        return SourceRole.BASE_CODE
    if col.startswith("rada_") and ("закон" in doc_type or "закон україни" in text):
        return SourceRole.PRIMARY_LAW

    if col in _BYLAW_COLLECTIONS:
        if any(marker in text for marker in ("порядок", "інструкц", "регламент", "процедур")):
            return SourceRole.ADMIN_PROCEDURE
        return SourceRole.BYLAW

    if col.startswith("rada_"):
        if any(marker in doc_type for marker in ("постанова", "наказ", "розпорядження")):
            return SourceRole.BYLAW
        return SourceRole.PRIMARY_LAW

    return SourceRole.OTHER


def _question_has_any(question: str, markers: tuple[str, ...]) -> bool:
    q = (question or "").lower()
    return any(marker in q for marker in markers)


def role_weight(intent: str, role: SourceRole, question: str) -> float:
    """Small role prior. Text relevance still dominates; roles break legal ties."""
    intent = (intent or "general_norm").lower()
    asks_court = "court" in intent or _question_has_any(
        question,
        ("суд", "судова практика", "верховн", "оскарж", "постанова вс", "правова позиц"),
    )
    asks_tax = "tax" in intent or _question_has_any(
        question,
        ("подат", "налог", "фоп", "єсв", "пдв", "єдиний", "зір", "дпс"),
    )
    asks_exact = "exact_value" in intent
    asks_procedure = "procedure" in intent or _question_has_any(
        question,
        ("як законно", "як правильно", "порядок", "процедур", "оформ", "документ"),
    )
    asks_advisory = "advisory" in intent or _question_has_any(
        question,
        ("краще", "лучше", "обрати", "вибрати", "выбрать", "рекомендац", "порівня", "сравн"),
    )
    asks_military = "military" in intent or _question_has_any(
        question,
        (
            "тцк", "влк", "мобілізац", "мобилизац", "відстроч", "отсроч",
            "бронюван", "бронь", "повіст", "повест", "військовозобов",
            "призов", "резервіст", "міноборони", "міністерство оборони",
            "військова служба", "військовий облік", "резерв+",
        ),
    )
    asks_changes = _question_has_any(question, ("внесення змін", "зміни до", "редакц", "істор", "коли змінил"))

    if role == SourceRole.AMENDING_ACT:
        return 0.05 if asks_changes else -0.16

    if asks_court:
        return {
            SourceRole.COURT_PRACTICE: 0.22,
            SourceRole.BASE_CODE: 0.12,
            SourceRole.PRIMARY_LAW: 0.10,
            SourceRole.BYLAW: 0.04,
            SourceRole.ADMIN_PROCEDURE: 0.03,
            SourceRole.TAX_EXPLANATION: -0.04,
            SourceRole.LEGAL_EXPLAINER: -0.10,
        }.get(role, 0.0)

    if asks_military:
        if "service" in intent or "medical" in intent:
            return {
                SourceRole.ADMIN_PROCEDURE: 0.16,
                SourceRole.BYLAW: 0.13,
                SourceRole.PRIMARY_LAW: 0.11,
                SourceRole.BASE_CODE: 0.10,
                SourceRole.COURT_PRACTICE: -0.07,
                SourceRole.TAX_EXPLANATION: -0.10,
                SourceRole.LEGAL_EXPLAINER: -0.12,
            }.get(role, 0.0)
        if "deferral" in intent:
            return {
                SourceRole.PRIMARY_LAW: 0.16,
                SourceRole.BYLAW: 0.14,
                SourceRole.ADMIN_PROCEDURE: 0.11,
                SourceRole.BASE_CODE: 0.10,
                SourceRole.COURT_PRACTICE: -0.06,
                SourceRole.TAX_EXPLANATION: -0.10,
                SourceRole.LEGAL_EXPLAINER: -0.12,
            }.get(role, 0.0)
        return {
            SourceRole.BYLAW: 0.15,
            SourceRole.ADMIN_PROCEDURE: 0.14,
            SourceRole.PRIMARY_LAW: 0.12,
            SourceRole.BASE_CODE: 0.10,
            SourceRole.COURT_PRACTICE: -0.06,
            SourceRole.TAX_EXPLANATION: -0.10,
            SourceRole.LEGAL_EXPLAINER: -0.12,
        }.get(role, 0.0)

    if asks_exact:
        return {
            SourceRole.BASE_CODE: 0.18,
            SourceRole.PRIMARY_LAW: 0.16,
            SourceRole.BYLAW: 0.12,
            SourceRole.ADMIN_PROCEDURE: 0.10,
            SourceRole.TAX_EXPLANATION: 0.10 if asks_tax else 0.02,
            SourceRole.COURT_PRACTICE: -0.12,
            SourceRole.LEGAL_EXPLAINER: -0.16,
        }.get(role, 0.0)

    if asks_procedure:
        return {
            SourceRole.BASE_CODE: 0.16,
            SourceRole.PRIMARY_LAW: 0.15,
            SourceRole.ADMIN_PROCEDURE: 0.13,
            SourceRole.BYLAW: 0.10,
            SourceRole.TAX_EXPLANATION: 0.08 if asks_tax else -0.02,
            SourceRole.COURT_PRACTICE: -0.07,
            SourceRole.LEGAL_EXPLAINER: -0.12,
        }.get(role, 0.0)

    if asks_advisory:
        return {
            SourceRole.BASE_CODE: 0.13,
            SourceRole.PRIMARY_LAW: 0.12,
            SourceRole.TAX_EXPLANATION: 0.12 if asks_tax else 0.02,
            SourceRole.BYLAW: 0.06,
            SourceRole.ADMIN_PROCEDURE: 0.06,
            SourceRole.COURT_PRACTICE: -0.06,
            SourceRole.LEGAL_EXPLAINER: -0.06,
        }.get(role, 0.0)

    if asks_tax:
        return {
            SourceRole.BASE_CODE: 0.14,
            SourceRole.PRIMARY_LAW: 0.13,
            SourceRole.TAX_EXPLANATION: 0.13,
            SourceRole.BYLAW: 0.04,
            SourceRole.ADMIN_PROCEDURE: 0.04,
            SourceRole.COURT_PRACTICE: -0.08,
            SourceRole.LEGAL_EXPLAINER: -0.08,
        }.get(role, 0.0)

    return {
        SourceRole.BASE_CODE: 0.11,
        SourceRole.PRIMARY_LAW: 0.10,
        SourceRole.BYLAW: 0.06,
        SourceRole.ADMIN_PROCEDURE: 0.05,
        SourceRole.TAX_EXPLANATION: 0.02,
        SourceRole.COURT_PRACTICE: -0.04,
        SourceRole.LEGAL_EXPLAINER: -0.06,
    }.get(role, 0.0)


def _base_relevance(result: dict[str, Any]) -> float:
    ans = result.get("_answerability") or {}
    ans_score = float(ans.get("score", 0.0) or 0.0)
    sim = float(result.get("similarity", 0.0) or 0.0)
    coverage = float(ans.get("coverage", 0.0) or 0.0)
    return ans_score + sim * 0.18 + coverage * 0.10


def _military_collection_weight(intent: str, result: dict[str, Any]) -> float:
    intent = (intent or "").lower()
    if "military" not in intent:
        return 0.0
    col = str(result.get("_collection") or "")
    if col == "laws_mod_v2":
        if "service" in intent or "medical" in intent:
            return 0.08
        if "summons" in intent or "accounting" in intent:
            return 0.04
        if "deferral" in intent:
            return 0.02
        return 0.04
    if col == "laws_kmu_v2":
        if "deferral" in intent or "summons" in intent or "accounting" in intent:
            return 0.08
        return 0.04
    if col in {"rada_state_v2", "rada_other_v2"}:
        if "deferral" in intent:
            return 0.09
        return 0.06
    if col in _COURT_COLLECTIONS and "court" not in intent:
        return -0.06
    return 0.0


def rerank_by_source_role(results: list[dict[str, Any]], intent: str, question: str) -> list[dict[str, Any]]:
    """Attach source roles and softly reorder results by legal authority."""
    if not results:
        return results

    enriched: list[dict[str, Any]] = []
    for result in results:
        role = infer_source_role(result)
        weight = role_weight(intent, role, question) + _military_collection_weight(intent, result)
        meta = result.get("out_metadata", {}) or {}
        if meta.get("rada_is_dead") or "втратив" in str(meta.get("status") or "").lower():
            weight -= 0.40

        result["_source_role"] = role.value
        result["_source_role_score"] = round(weight, 4)
        result["_source_role_rank_score"] = round(_base_relevance(result) + weight, 4)
        # Small compatibility nudge for existing squeeze/tie-breakers.
        result["similarity"] = max(0.0, min(1.0, float(result.get("similarity", 0.0) or 0.0) + weight * 0.12))
        enriched.append(result)

    enriched.sort(
        key=lambda r: (
            float(r.get("_source_role_rank_score", 0.0) or 0.0),
            float((r.get("_answerability") or {}).get("coverage", 0.0) or 0.0),
            float(r.get("similarity", 0.0) or 0.0),
        ),
        reverse=True,
    )
    return enriched


def role_summary(results: list[dict[str, Any]], limit: int = 8) -> list[str]:
    out: list[str] = []
    for r in results[:limit]:
        meta = r.get("out_metadata", {}) or {}
        out.append(
            f"{r.get('_collection')}:{meta.get('law_id', '?')}:"
            f"{r.get('_source_role', '?')}:{float(r.get('_source_role_score', 0.0) or 0.0):+.2f}"
        )
    return out
