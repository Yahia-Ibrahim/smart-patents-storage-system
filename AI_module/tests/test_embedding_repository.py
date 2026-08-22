from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database.models import Base, EmbeddingRecord
from app.models.dto import EmbeddingDTO
from app.repositories.embedding_repository import EmbeddingRepository


def test_embedding_repository_acts_as_cache_for_patent_embeddings():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)
    repository = EmbeddingRepository(session_factory=session_factory)

    dto = EmbeddingDTO(
        patent_id=143,
        embedding=[0.1, 0.2, 0.3],
        model_name="default-model",
    )

    repository.store_embedding(dto)
    cached = repository.get_embedding(143)
    deleted = repository.delete_embedding(143)

    assert cached is not None
    assert cached.patent_id == 143
    assert cached.embedding == [0.1, 0.2, 0.3]
    assert deleted is True
