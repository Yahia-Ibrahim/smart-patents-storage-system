from __future__ import annotations

import os

from langchain_qdrant import QdrantVectorStore

from app.langchain.embeddings import get_embeddings
from app.services.vector_store_service import VectorStoreService


def get_vector_store() -> QdrantVectorStore:
    url = os.getenv(
        "QDRANT_URL",
        "http://qdrant:6333",
    )

    collection_name = os.getenv(
        "QDRANT_COLLECTION",
        "patents",
    )

    # from_existing_collection() raises when the collection is absent, and on a
    # cold stack nothing has created it yet: the consumer process creates it in
    # VectorStoreService.__init__, and the API container can reach this line
    # first. Constructing that same service here creates it idempotently, so the
    # collection's shape still has exactly one definition.
    VectorStoreService(collection_name=collection_name)

    embeddings = get_embeddings()

    return QdrantVectorStore.from_existing_collection(
        embedding=embeddings,
        collection_name=collection_name,
        url=url,
        content_payload_key="abstract",
        metadata_payload_key="metadata",
    )