import argparse
import json
import os
import sys
import time
from typing import Any

import requests


DEFAULT_QUESTIONS = [
    "дай инфо по калькуляции загран командировок по законодательству - как рассчитываются они от какой суммы или тому подобное",
    "в якій це валюті розрахунки",
    "а для приватного підприємства так само?",
]


def _load_token(args: argparse.Namespace) -> str:
    if args.token:
        return args.token.strip()
    if args.token_file:
        with open(args.token_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    return os.environ.get("CHAT_TEST_TOKEN", "").strip()


def _post_ask(
    base_url: str,
    question: str,
    history: list[dict[str, str]],
    max_docs: int,
    token: str,
) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    response = requests.post(
        f"{base_url.rstrip('/')}/ask",
        headers=headers,
        json={
            "question": question,
            "history": history,
            "max_docs": max_docs,
            "filter_sources": ["rada", "kmu", "wiki", "supreme", "ccu", "lpd", "mod", "zir"],
            "response_features": ["response_detailed", "response_steps", "response_scenarios", "response_vs_position"],
            "response_length_pref": "detailed",
            "response_lang_style": "legal",
        },
        timeout=190,
    )
    if response.status_code == 401:
        raise RuntimeError(
            "401 Unauthorized. You may be hitting the protected frontend/proxy instead of the Python backend "
            "(try --base-url http://localhost:8080 on the server). If this endpoint is intentionally protected, "
            "pass a Supabase access token with --token, --token-file, or CHAT_TEST_TOKEN."
        )
    response.raise_for_status()
    return response.json()


def _print_result(index: int, question: str, data: dict[str, Any], elapsed: float) -> None:
    answer = str(data.get("answer", "")).strip()
    meta = data.get("_meta") or {}
    refs = data.get("references") or []

    print("=" * 88)
    print(f"Q{index}: {question}")
    print(
        f"elapsed={elapsed:.1f}s top_score={meta.get('top_score')} "
        f"n_docs={meta.get('n_docs')} low_confidence={meta.get('low_confidence')}"
    )
    print("- answer preview -")
    print(answer[:1500].replace("\n\n\n", "\n\n"))
    if len(answer) > 1500:
        print("... [truncated]")
    print("- references -")
    for ref in refs[:8]:
        num = ref.get("num")
        title = ref.get("source_title") or ""
        url = ref.get("law_url") or ""
        chunk = ref.get("chunk_index")
        print(f"[{num}] chunk={chunk} {title[:160]} {url}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run repeatable chat quality checks against FastAPI /ask.")
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--max-docs", type=int, default=15)
    parser.add_argument("--question", action="append", help="Override scenario questions. Can be passed multiple times.")
    parser.add_argument("--json-out", default="", help="Optional path to write full JSON results.")
    parser.add_argument("--token", default="", help="Supabase access token for protected /ask endpoints.")
    parser.add_argument("--token-file", default="", help="Path to a file containing the Supabase access token.")
    args = parser.parse_args()

    token = _load_token(args)
    questions = args.question or DEFAULT_QUESTIONS
    history: list[dict[str, str]] = []
    full_results: list[dict[str, Any]] = []

    for idx, question in enumerate(questions, start=1):
        started = time.time()
        try:
            data = _post_ask(args.base_url, question, history, args.max_docs, token)
        except RuntimeError as e:
            print(str(e), file=sys.stderr)
            sys.exit(2)
        elapsed = time.time() - started
        _print_result(idx, question, data, elapsed)

        answer = str(data.get("answer", "")).strip()
        history.append({"role": "user", "content": question})
        history.append({"role": "assistant", "content": answer[:4000]})
        full_results.append({"question": question, "elapsed": elapsed, "response": data})

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(full_results, f, ensure_ascii=False, indent=2)
        print(f"Wrote {args.json_out}")


if __name__ == "__main__":
    main()
