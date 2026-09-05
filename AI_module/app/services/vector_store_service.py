"""
Qdrant vector database service.
"""

from __future__ import annotations

import os

from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    PointStruct,
    VectorParams,
    ScoredPoint
)

from app.exceptions.exceptions import VectorStoreException
from app.models.dto import QdrantPayloadDTO



class VectorStoreService:
    """
    Wrapper around Qdrant.
    """

    def __init__(self, host: str | None = None, port: int | None = None, collection_name: str | None = None):

        self.collection_name = (
            collection_name
            or os.getenv(
                "QDRANT_COLLECTION",
                "patents",
            )
        )

        self.client = QdrantClient(
            host=host or os.getenv("QDRANT_HOST", "localhost"),
            port=port or int(os.getenv("QDRANT_PORT", 6333)),
        )

        self._initialize_collection()

    def insert_embedding(
        self,
        embedding: list[float],
        payload: QdrantPayloadDTO,
    ) -> None:
        """
        Insert or update a patent vector.
        """

        try:
            point = PointStruct(
                id=payload.patent_id,
                vector=embedding,
                payload={
                    "title": payload.patent_title,
                    # "application_number": payload.application_number,
                    "submitted_at": payload.submitted_at,
                    "model": payload.model_name,
                    "model_name": payload.model_name,
                    "abstract": payload.abstract,
                    
                    # LangChain reads this for doc.page_content
                    "page_content": payload.abstract,  # Or whichever field holds main text
                    
                    # LangChain unpacks this sub-dict into doc.metadata
                    "metadata": {
                        "title": payload.patent_title,
                        "submitted_at": payload.submitted_at,
                        "model": payload.model_name,
                        "model_name": payload.model_name,
                        "abstract": payload.abstract,
                    }
                },
            )

            self.client.upsert(
                collection_name=self.collection_name,
                points=[point],
            )

        except Exception as ex:

            raise VectorStoreException(
                f"Failed inserting patent {payload.patent_id}"
            ) from ex

    def search(self, embedding: list[float], limit: int = 5,) -> list[ScoredPoint]:
        """
        Return the nearest vectors.
        """
        try:
            response = self.client.query_points(
                collection_name=self.collection_name,
                query=embedding,
                limit=limit,
            )
            return response.points

        except Exception as ex:
            raise VectorStoreException("Vector search failed.") from ex

    def delete_embedding(self, patent_id: int) -> None:
        """
        Remove a patent from Qdrant.
        """
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=[patent_id],
            )
        except Exception as ex:
            raise VectorStoreException(f"Failed deleting patent {patent_id}") from ex

    def collection_exists(self) -> bool:
        return self.client.collection_exists(self.collection_name)

    def create_collection(self, vector_size: int) -> None:

        self.client.create_collection(
            collection_name=self.collection_name,
            vectors_config=VectorParams(
                size=vector_size,
                distance=Distance.COSINE,
            ),
        )

    def _initialize_collection(self) -> None:
        if self.collection_exists():
            return

        self.create_collection(
            vector_size=int(
                os.getenv(
                    "EMBEDDING_DIM",
                    384,
                )
            )
        )