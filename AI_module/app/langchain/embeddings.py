from __future__ import annotations

import os

from langchain_huggingface import HuggingFaceEmbeddings


def get_embeddings() -> HuggingFaceEmbeddings:
    model_name = os.getenv(
        "EMBEDDING_MODEL_NAME",
        "sentence-transformers/all-MiniLM-L6-v2",
    )

    return HuggingFaceEmbeddings(
        model_name=model_name, 
        encode_kwargs={
            "normalize_embeddings": True,
        },
    )