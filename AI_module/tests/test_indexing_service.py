from pathlib import Path

from app.services.indexing_service import IndexingService


class DummyExtractor:
    def extract_text(self, file_path):
        return f"extracted:{Path(file_path).name}"


class DummyEmbeddingService:
    def generate_embedding(self, text):
        return [0.1, 0.2, 0.3]


class DummyEmbeddingRepository:
    def __init__(self, cached=None):
        self.calls = []
        self.deleted = []
        self.cached = cached

    def store_embedding(self, payload, embedding, text):
        self.calls.append((payload, embedding, text))

    def delete_embedding(self, payload):
        self.deleted.append(payload)

    def get_embedding(self, payload):
        return self.cached


class DummyReportGenerator:
    def __init__(self):
        self.calls = []

    def generate_report(self, payload, text, embedding):
        self.calls.append((payload, text, embedding))
        return {"status": "generated"}


def test_index_patent_runs_download_extract_embed_and_persist_flow(tmp_path):
    document_path = tmp_path / "patent.pdf"
    document_path.write_bytes(b"pdf-bytes")

    repository = DummyEmbeddingRepository()
    report_generator = DummyReportGenerator()
    service = IndexingService(
        document_extractor=DummyExtractor(),
        embedding_service=DummyEmbeddingService(),
        embedding_repository=repository,
        report_generator=report_generator,
    )
    service._download_document = lambda payload: str(document_path)

    payload = {
        "eventId": "evt-001",
        "patentId": 143,
        "title": "Neural Traffic Prediction for Smart Cities",
        "applicationNumber": "US-2026-001234",
        "fileUrl": "https://minio/patents/143.pdf",
        "submittedBy": 17,
        "submittedAt": "2026-07-18T10:15:00Z",
    }

    result = service.index_patent(payload)

    assert result["status"] == "indexed"
    assert result["patentId"] == 143
    assert repository.calls[0][0]["patentId"] == 143
    assert report_generator.calls[0][1].startswith("extracted:")
    assert report_generator.calls[0][2] == [0.1, 0.2, 0.3]


def test_approve_patent_uses_cached_embedding_when_available():
    class DummyVectorStoreService:
        def __init__(self):
            self.calls = []

        def insert_embedding(self, payload, embedding, text):
            self.calls.append((payload, embedding, text))

    repository = DummyEmbeddingRepository(cached={"embedding": [1.0, 2.0], "text": "cached"})
    vector_store = DummyVectorStoreService()
    service = IndexingService(
        embedding_service=DummyEmbeddingService(),
        embedding_repository=repository,
        vector_store_service=vector_store,
    )

    payload = {"eventId": "evt-002", "patentId": 144, "title": "Autonomous Drone Routing"}
    result = service.approve_patent(payload)

    assert result["status"] == "approved"
    assert result["source"] == "cache"
    assert vector_store.calls[0][0]["patentId"] == 144
    assert vector_store.calls[0][1] == [1.0, 2.0]


def test_reject_patent_deletes_embedding_from_repository_if_present():
    repository = DummyEmbeddingRepository()
    service = IndexingService(embedding_repository=repository)

    payload = {"eventId": "evt-003", "patentId": 145, "title": "Spacecraft Navigation"}
    result = service.reject_patent(payload)

    assert result["status"] == "rejected"
    assert result["deleted"] is True
    assert repository.deleted[0]["patentId"] == 145
