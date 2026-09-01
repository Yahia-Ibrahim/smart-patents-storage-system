from __future__ import annotations

from app.langchain.vector_store import get_vector_store
from app.models.dto import SearchResultDTO
import os

class PatentRetriever:
    def __init__(self) -> None:
        self.vector_store = get_vector_store()

        self.top_k = int(
            os.getenv("SEARCH_TOP_K", "5")
        )

    def retrieve(self, query: str) -> list[SearchResultDTO]:
        documents_with_scores = (
            self.vector_store.similarity_search_with_score(
                query,
                k=self.top_k,
            )
        )

        search_results = []

        for document, score in documents_with_scores:
            payload = document.metadata
            print(document)
            print(document.page_content)
            print(document.metadata)
            abstract = payload.get("abstract") or str(document.page_content)
            patent_id = payload.get("_id") or payload.get("id") or payload["_id"]
            search_results.append(
                SearchResultDTO(
                    patent_id=int(patent_id) if patent_id is not None else None,
                    title=payload.get("title", ""),
                    abstract=abstract,
                    score=float(score),
                )
            )

        return search_results