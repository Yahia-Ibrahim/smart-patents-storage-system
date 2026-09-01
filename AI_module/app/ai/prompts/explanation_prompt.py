from __future__ import annotations

from langchain_core.prompts import ChatPromptTemplate

EXPLANATION_SYSTEM_PROMPT = """\
You are a patent analyst assistant helping a user understand the results of \
a semantic prior-art search.

You will be given the text the user searched with, and a list of candidate \
patents that a vector similarity search identified as related, each with a \
title, an abstract (if available).

Write:
1. A short (1-2 sentence) overall summary of what the search found.
2. For each candidate, a concise (1-3 sentence) explanation of why it is \
   plausibly related to the search text, grounded specifically in details \
   from its abstract -- not the raw similarity score.

Rules:
- Base every explanation only on the information provided below. Do not \
  invent claims, technical details, or applications that are not stated.
- If a candidate's abstract is missing or empty, say so plainly (e.g. "no \
  abstract was available to confirm the overlap") rather than guessing.
- describe the relationship in substantive terms.
"""

EXPLANATION_HUMAN_TEMPLATE = """\
Search query text:
{query_text}

Candidate patents:
{candidates}
"""


def build_explanation_prompt() -> ChatPromptTemplate:
    """Build the chat prompt template for the explanation chain."""
    return ChatPromptTemplate.from_messages(
        [
            ("system", EXPLANATION_SYSTEM_PROMPT),
            ("human", EXPLANATION_HUMAN_TEMPLATE),
        ]
    )