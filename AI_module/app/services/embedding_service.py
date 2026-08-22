# app/services/embedding_service.py

from __future__ import annotations

import os

from sentence_transformers import SentenceTransformer


class EmbeddingService:
    """
    Generates dense vector embeddings for patent documents.
    """

    def __init__(self, model_name: str | None = None):
        self.model_name = (
            model_name
            or os.getenv(
                "EMBEDDING_MODEL_NAME",
                "sentence-transformers/all-MiniLM-L6-v2",
            )
        )

        self.model = SentenceTransformer(self.model_name)

    def generate_embedding(self, text: str) -> list[float]:
        """
        Generate an embedding for a document.
        """

        if not text.strip():
            raise ValueError("Document text is empty.")

        embedding = self.model.encode(
            text,
            normalize_embeddings=True,
            convert_to_numpy=True,
        )

        return embedding.tolist()