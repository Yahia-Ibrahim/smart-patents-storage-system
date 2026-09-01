from __future__ import annotations

import os

from langchain_qdrant import QdrantVectorStore

from app.langchain.embeddings import get_embeddings


def get_vector_store() -> QdrantVectorStore:
    url = os.getenv(
        "QDRANT_URL",
        "http://qdrant:6333",
    )

    collection_name = os.getenv(
        "QDRANT_COLLECTION",
        "patents",
    )

    embeddings = get_embeddings()

    return QdrantVectorStore.from_existing_collection(
        embedding=embeddings,
        collection_name=collection_name,
        url=url,
        content_payload_key="abstract",
        metadata_payload_key="metadata",
    )