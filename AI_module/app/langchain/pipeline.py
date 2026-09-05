from __future__ import annotations

import os

from pydantic import BaseModel

from app.ai.chains.explanation_chain import (
    SearchExplanationDTO,
    build_explanation_chain,
    explain_search_results,
)
from app.ai.models.llm_client import get_llm
from app.langchain.retriever import PatentRetriever
from app.models.dto import SearchResultDTO


class PatentSearchPipelineResult(BaseModel):
    candidates: list[SearchResultDTO]
    explanation: SearchExplanationDTO


class PatentSearchPipeline:
    """
    Query-time patent search pipeline.

    Flow:

        query
          ↓
        embedding
          ↓
        Qdrant retrieval
          ↓
        candidate patents
          ↓
        LLM explanation
          ↓
        candidates + explanation
    """

    def __init__(self) -> None:
        self.retriever = PatentRetriever()

        llm = get_llm(
            model_name=os.getenv("LLM_MODEL_NAME"),
            temperature=0.0,
        )

        self.explanation_chain = build_explanation_chain(llm)

    def search(
        self,
        query_text: str,
    ) -> PatentSearchPipelineResult:

        candidates = self.retriever.retrieve(query_text)

        explanation = explain_search_results(
            chain=self.explanation_chain,
            query_text=query_text,
            results=candidates,
        )

        return PatentSearchPipelineResult(
            candidates=candidates,
            explanation=explanation,
        )