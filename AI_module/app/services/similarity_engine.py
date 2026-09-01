"""
Patent similarity search service.
"""

from __future__ import annotations

from app.exceptions.exceptions import SimilaritySearchException
from app.models.dto import SearchResultDTO


class SimilarityEngine:
    """
    Performs semantic similarity search over indexed patents.
    """

    def __init__(self, vector_store_service):
        self.vector_store_service = vector_store_service

    def search_similar_patents(
        self,
        embedding: list[float],
        limit: int = 5,
    ) -> list[SearchResultDTO]:
        """
        Search the vector store for similar patents.
        """

        try:
            results = self.vector_store_service.search(
                embedding,
                limit,
            )

            return [
                SearchResultDTO(
                    patent_id=result.id,
                    title=result.payload["title"],
                    score=result.score,
                    abstract=result.payload.get("abstract", "") or "",
                )
                for result in results
            ]

        except Exception as ex:
            raise SimilaritySearchException(
                "Failed to search similar patents."
            ) from ex