from app.database.models import AdminRecord, EmbeddingRecord
from app.models.dto import (
    EmbeddingDTO,
    PatentApprovedEventDTO,
    PatentRejectedEventDTO,
    PatentSubmittedEventDTO,
    QdrantPayloadDTO,
    SearchResultDTO,
    SimilarityReportDTO,
)


def test_event_dtos_parse_payloads_with_expected_fields():
    submitted_payload = {
        "eventId": "evt-1",
        "patentId": 143,
        "title": "Neural Traffic Prediction for Smart Cities",
        "applicationNumber": "US-2026-001234",
        "fileUrl": "https://minio/patents/143.pdf",
        "submittedBy": 17,
        "submittedAt": "2026-07-18T10:15:00Z",
    }
    approved = PatentApprovedEventDTO.model_validate(submitted_payload)
    rejected = PatentRejectedEventDTO.model_validate(submitted_payload)
    submitted = PatentSubmittedEventDTO.model_validate(submitted_payload)

    assert approved.patentId == 143
    assert rejected.title == submitted_payload["title"]
    assert submitted.applicationNumber == submitted_payload["applicationNumber"]


def test_embedding_and_similarity_report_dtos_model_fields():
    embedding = EmbeddingDTO(patent_id=143, embedding=[0.1, 0.2], model_name="demo")
    qdrant = QdrantPayloadDTO(
        patent_id=143,
        embedding=[0.1, 0.2],
        model_name="demo",
        patent_title="Test Patent",
        submitted_at="2026-07-18T10:15:00Z",
    )
    search_result = SearchResultDTO(patent_id=999, title="Related", score=0.95)
    report = SimilarityReportDTO(patent_id=143, title="Test Patent", matches=[search_result])

    assert embedding.patent_id == 143
    assert qdrant.patent_title == "Test Patent"
    assert report.matches[0].score == 0.95


def test_database_models_have_expected_table_names():
    assert EmbeddingRecord.__tablename__ == "embeddings"
    assert AdminRecord.__tablename__ == "admins"
