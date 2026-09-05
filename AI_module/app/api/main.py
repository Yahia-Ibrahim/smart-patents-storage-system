from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes.patent_search import router as patent_search_router
from app.langchain.pipeline import PatentSearchPipeline


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.patent_search_pipeline = PatentSearchPipeline()

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