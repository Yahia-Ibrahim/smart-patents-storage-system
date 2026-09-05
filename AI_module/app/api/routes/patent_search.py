from fastapi import APIRouter, Request

from app.schemas.patent_search import (
    PatentSearchRequest,
    PatentSearchResponse,
    PatentSearchResult,
)

router = APIRouter(
    prefix="/api/v1/patents",
    tags=["Patent Search"],
)


@router.post(
    "/search",
    response_model=PatentSearchResponse,
)
def search_patents(
    request: PatentSearchRequest,
    http_request: Request,
) -> PatentSearchResponse:

    pipeline = http_request.app.state.patent_search_pipeline

    pipeline_result = pipeline.search(request.text)

    explanations_by_patent_id = {
        match.patent_id: match.why_it_matches
        for match in pipeline_result.explanation.matches
    }

    results = [
        PatentSearchResult(
            patent_id=candidate.patent_id,
            title=candidate.title,
            why_they_overlap=explanations_by_patent_id.get(
                candidate.patent_id
            ),
        )
        for candidate in pipeline_result.candidates
    ]

    return PatentSearchResponse(
        summary=pipeline_result.explanation.summary,
        results=results,
    )