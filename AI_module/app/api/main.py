from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes.patent_search import router as patent_search_router
from app.langchain.pipeline import PatentSearchPipeline


class _LazyPatentSearchPipeline:
    """Build the real pipeline on first search rather than at startup.

    Constructing PatentSearchPipeline eagerly makes the process refuse to boot
    unless three things are already true: Qdrant is reachable, the embedding
    model can be downloaded, and GOOGLE_API_KEY is set for the Gemini client.
    Any one of them failing puts the container in a restart loop where even
    /docs is unreachable, and in the integrated compose stack the API routinely
    starts before the consumer has created the collection.

    Deferring turns a boot crash into a per-request error the caller can see
    and the backend can report. Same `.search()` shape, so the route is
    unchanged.
    """

    def __init__(self) -> None:
        self._pipeline: PatentSearchPipeline | None = None

    def search(self, query_text: str):
        if self._pipeline is None:
            self._pipeline = PatentSearchPipeline()

        return self._pipeline.search(query_text)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.patent_search_pipeline = _LazyPatentSearchPipeline()

    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Smart Patents Storage AI Service",
        version="1.0.0",
        description="AI-powered patent search and similarity analysis service.",
        lifespan=lifespan,
    )

    app.include_router(patent_search_router)

    return app


app = create_app()
