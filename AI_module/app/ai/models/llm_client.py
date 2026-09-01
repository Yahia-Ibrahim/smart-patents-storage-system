from __future__ import annotations

import os

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI


def get_llm(
    model_name: str | None = None,
    temperature: float = 0.0,
) -> BaseChatModel:
    """
    Build the LLM used for patent-search result explanation.

    Uses Gemini through the Google AI API.
    """

    return ChatGoogleGenerativeAI(
        model=model_name or os.getenv(
            "LLM_MODEL_NAME",
            "gemini-2.5-flash",
        ),
        temperature=temperature,
        max_retries=2,
    )