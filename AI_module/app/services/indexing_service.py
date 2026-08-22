"""High-level indexing workflow for patent lifecycle events."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse
from urllib.request import urlretrieve

from app.exceptions import VectorStoreException
from app.models.dto import (
    EmbeddingDTO,
    PatentApprovedEventDTO,
    PatentRejectedEventDTO,
    PatentSubmittedEventDTO,
    QdrantPayloadDTO,
    SearchResultDTO,
    SimilarityReportDTO,
)


class IndexingService:
    """Coordinate the indexing, approval, and rejection flows for patents."""

    def __init__(
        self,
        document_extractor=None,
        embedding_service=None,
        vector_store_service=None,
        embedding_repository=None,
        similarity_engine=None,
        report_generator=None,
        notification_producer=None
    ):
        self.document_extractor = document_extractor
        self.embedding_service = embedding_service
        self.vector_store_service = vector_store_service
        self.embedding_repository = embedding_repository
        self.report_generator = report_generator
        self.similarity_engine = similarity_engine
        self.notification_producer = notification_producer

    def _download_document(self, payload: PatentSubmittedEventDTO | PatentApprovedEventDTO) -> str:
        """Download the patent document from the supplied MinIO-compatible object URL."""
        file_url = payload.fileUrl or ""
        if not file_url:
            raise ValueError("payload is missing fileUrl")

        parsed = urlparse(file_url)
        file_name = Path(parsed.path).name or f"patent-{payload.patentId}.pdf"
        destination = Path(os.getenv("TMP_DIR", "/tmp")) / file_name
        destination.parent.mkdir(parents=True, exist_ok=True)

        # The service currently uses a direct HTTP download for object URLs.
        # This keeps the flow simple while still allowing MinIO-style URLs to pass through.
        urlretrieve(file_url, destination)

        return str(destination)

    def _extract_document_text(self, document_path: str) -> str:
        """Extract text from a downloaded document using the document extractor."""
        if self.document_extractor is None:
            return ""
        return self.document_extractor.extract_text(document_path)

    def _generate_embedding(self, text: str) -> list[float]:
        """Generate an embedding for the extracted patent text."""
        if self.embedding_service is None:
            return []
        return self.embedding_service.generate_embedding(text)

    def _store_embedding(self, payload: PatentSubmittedEventDTO | PatentApprovedEventDTO, embedding: list[float]) -> None:
        """Persist the embedding in the repository as a low-priority task."""
        if self.embedding_repository is None:
            return
        try:
            embedding_dto = EmbeddingDTO(
                patent_id=payload.patentId,
                embedding=embedding,
                model_name=os.getenv("EMBEDDING_MODEL_NAME", "default-model"),
            )
            self.embedding_repository.store_embedding(embedding_dto)
        except Exception:
            # The persistence layer is intentionally non-blocking.
            return

    def _generate_report(self, payload: PatentSubmittedEventDTO | PatentApprovedEventDTO, embedding: list[float]) -> None:
        """Generate a report using the configured report generator if available."""
        if self.report_generator is None or self.similarity_engine is None:
            return
        
        matches = self.similarity_engine.search_similar_patents(embedding)
        report = self.report_generator.generate_report(payload, matches)
        self.notification_producer.publish_similarity_report(report)

    def _insert_embedding_into_vector_store(self, payload: PatentSubmittedEventDTO | PatentApprovedEventDTO, embedding: list[float]) -> None:
        """Insert the embedding into the vector store service if available."""
        if self.vector_store_service is None:
            return

        qdrant_payload = QdrantPayloadDTO(
            patent_id=payload.patentId,
            model_name=os.getenv("EMBEDDING_MODEL_NAME", "default-model"),
            patent_title=payload.title,
            # application_number=payload.applicationNumber,
            submitted_at=payload.submittedAt,
        )
        self.vector_store_service.insert_embedding(embedding, qdrant_payload)


    def _get_cached_embedding(self, patentId: int) -> Optional[EmbeddingDTO]:
        """Return an embedding record from the repository cache if it exists."""
        if self.embedding_repository is None:
            return None
        try:
            return self.embedding_repository.get_embedding(patentId)
        except Exception:
            return None
        

    def _compute_embedding(self, payload: PatentSubmittedEventDTO | PatentApprovedEventDTO) -> list[float]:
        """Compute an embedding for the patent by downloading and processing the document."""
        document_path = self._download_document(payload)
        text = self._extract_document_text(document_path)
        embedding = self._generate_embedding(text)
        return embedding

    def handle_submitted_patent(self, payload: PatentSubmittedEventDTO) -> None:
        """Trigger indexing for a newly submitted patent."""
        embedding = self._compute_embedding(payload)
        self._store_embedding(payload, embedding)
        self._generate_report(payload, embedding)

    def handle_approved_patent(self, payload: PatentApprovedEventDTO) -> None:
        """Handle approval of a patent by using a cached embedding if available, otherwise recomputing it."""
        cached_embedding = self._get_cached_embedding(payload.patentId)

        if cached_embedding is not None:
            embedding = cached_embedding.embedding
            self._insert_embedding_into_vector_store(payload, embedding)
            return

        embedding = self._compute_embedding(payload)
        self._insert_embedding_into_vector_store(payload, embedding)

    def handle_rejected_patent(self, payload: PatentRejectedEventDTO) -> None:
        """Handle rejection of a patent by removing the embedding from the embedding repository if present."""
        if self.embedding_repository is not None:
            try:
                self.embedding_repository.delete_embedding(payload.patentId)
            except Exception:
                return
