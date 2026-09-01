from __future__ import annotations

from typing import Iterable

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import Runnable
from pydantic import BaseModel, Field

from app.ai.prompts.explanation_prompt import build_explanation_prompt
from app.models.dto import SearchResultDTO


class MatchExplanationDTO(BaseModel):
    """Explanation for a single search match, keyed by patent_id."""

    patent_id: int = Field(
        description="patent_id of the candidate this explanation refers to."
    )
    why_it_matches: str = Field(
        description=(
            "1-3 sentence explanation of why this patent is relevant to "
            "the search text, grounded in its abstract."
        )
    )


class SearchExplanationDTO(BaseModel):
    """Structured output contract for the explanation chain."""

    summary: str = Field(
        description="1-2 sentence overview of what the search found overall."
    )
    matches: list[MatchExplanationDTO]


def _format_candidates(results: Iterable[SearchResultDTO]) -> str:
    """Render matches as plain text for the prompt's {candidates} slot."""
    lines: list[str] = []

    for result in results:
        abstract = (
            result.abstract.strip()
            if result.abstract
            else "(no abstract available)"
        )

        lines.append(
            f'- patent_id={result.patent_id} | title="{result.title}"\n'
            f"  abstract: {abstract}"
        )

    return "\n".join(lines) if lines else "(no candidates found)"


def build_explanation_chain(llm: BaseChatModel) -> Runnable:
    """
    Build the LCEL chain: prompt | llm bound to structured output.

    Takes a dict with "query_text" and "candidates" (pre-formatted text)
    and returns a SearchExplanationDTO.
    """
    prompt = build_explanation_prompt()
    structured_llm = llm.with_structured_output(SearchExplanationDTO)
    return prompt | structured_llm


def explain_search_results(
    chain: Runnable,
    query_text: str,
    results: list[SearchResultDTO],
) -> SearchExplanationDTO:
    """
    Invoke the explanation chain with retrieved matches already in hand.

    Callers (e.g. a search service) are responsible for retrieval; this
    function only formats matches for the prompt and invokes the chain.
    """
    return chain.invoke(
        {
            "query_text": query_text,
            "candidates": _format_candidates(results),
        }
    )