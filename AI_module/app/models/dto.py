from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

class PatentEventDTO(BaseModel):
    eventId: str
    patentId: int
    title: str
    applicationNumber: str
    fileUrl: str
    submittedBy: int
    submittedAt: str

class PatentSubmittedEventDTO(PatentEventDTO):
    pass


class PatentApprovedEventDTO(PatentEventDTO):
    pass


class PatentRejectedEventDTO(PatentEventDTO):
    pass


class EmbeddingDTO(BaseModel):
    patent_id: int
    embedding: list[float]
    model_name: str


class QdrantPayloadDTO(BaseModel):
    patent_id: int
    model_name: str
    patent_title: str
    submitted_at: str


class SearchResultDTO(BaseModel):
    patent_id: int
    title: str
    score: float


class SimilarityReportDTO(BaseModel):
    patent_id: int
    title: str
    matches: list[SearchResultDTO]
