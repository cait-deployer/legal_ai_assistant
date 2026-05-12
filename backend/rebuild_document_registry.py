"""Rebuild fast document registry from Qdrant V2 payloads."""

from __future__ import annotations

from document_registry import build_document_registry, registry_status
from qdrant_storage import ALL_V2_COLLECTIONS


def main() -> None:
    print("Current registry:", registry_status(), flush=True)
    build_document_registry(ALL_V2_COLLECTIONS)
    print("Updated registry:", registry_status(), flush=True)


if __name__ == "__main__":
    main()
