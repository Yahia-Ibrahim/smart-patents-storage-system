"""High-level indexing workflow for patent lifecycle events."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse
from urllib.request import urlretrieve

from app.exceptions.exceptions import VectorStoreException
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
        self._object_storage_client = None

    def _get_object_storage_client(self):
        """Lazily build the MinIO client used for ``s3://`` documents."""
        if self._object_storage_client is None:
            from minio import Minio

            endpoint = os.getenv("S3_ENDPOINT", "minio:9000")
            # Minio() wants a bare host:port, but the rest of the system
            # configures endpoints as full URLs, so accept either.
            parsed = urlparse(endpoint)
            secure = parsed.scheme == "https"
            host = parsed.netloc or parsed.path

            self._object_storage_client = Minio(
                host,
                access_key=os.getenv("S3_ACCESS_KEY_ID", ""),
                secret_key=os.getenv("S3_SECRET_ACCESS_KEY", ""),
                secure=secure,
            )

        return self._object_storage_client

    def _download_document(self, payload: PatentSubmittedEventDTO | PatentApprovedEventDTO) -> str:
        """Download the patent document from the supplied MinIO-compatible object URL."""
        file_url = payload.fileUrl or ""
        if not file_url:
            raise ValueError("payload is missing fileUrl")

        parsed = urlparse(file_url)
        file_name = Path(parsed.path).name or f"patent-{payload.patentId}.pdf"
        destination = Path(os.getenv("TMP_DIR", "/tmp")) / file_name
        destination.parent.mkdir(parents=True, exist_ok=True)

        if parsed.scheme == "s3":
            # The patent backend stores documents in a private bucket and emits
            # an s3://bucket/key URI rather than a presigned URL: a presigned
            # URL would expire while the event was still queued, leaving events
            # that could never be processed. Fetching by key has no expiry.
            bucket = parsed.netloc
            object_key = parsed.path.lstrip("/")

            self._get_object_storage_client().fget_object(
                bucket,
                object_key,
                str(destination),
            )

            return str(destination)

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
            abstract=payload.abstract or "",
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
        """Handle rejection of a patent by removing it from the cache and the vector store."""
        if self.embedding_repository is not None:
            try:
                self.embedding_repository.delete_embedding(payload.patentId)
            except Exception:
                pass

        # The vector store removal was missing, so a patent that was approved
        # and later declined stayed in the similarity corpus permanently and
        # kept being returned as prior art for new submissions. Kept as its own
        # guarded block rather than sharing the one above: a failure to clear
        # the cache must not skip removing the vector, which is the half that
        # is externally visible.
        if self.vector_store_service is not None:
            try:
                self.vector_store_service.delete_embedding(payload.patentId)
            except Exception:
                return
