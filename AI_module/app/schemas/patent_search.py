from pydantic import BaseModel, Field


class PatentSearchRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description="Text to search for relevant patents."
    )


class PatentSearchResult(BaseModel):
    patent_id: int
    title: str
    why_they_overlap: str | None = None


class PatentSearchResponse(BaseModel):
    summary: str
    results: list[PatentSearchResult]