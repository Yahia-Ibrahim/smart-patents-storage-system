from __future__ import annotations

import json
from typing import Optional

from sqlalchemy.orm import Session

from app.database.models import EmbeddingRecord
from app.exceptions.exceptions import EmbeddingRepositoryException
from app.models.dto import EmbeddingDTO


class EmbeddingRepository:
    """Repository-backed cache for patent embeddings."""

    def __init__(self, session_factory=None):
        self.session_factory = session_factory

    def _get_session(self) -> Session:
        if self.session_factory is None:
            from app.database.database import SessionLocal

            return SessionLocal()
        return self.session_factory()

    def store_embedding(self, embedding_dto: EmbeddingDTO) -> None:
        """Store or update an embedding in the cache."""
        session = self._get_session()
        try:
            record = session.query(EmbeddingRecord).filter_by(patent_id=embedding_dto.patent_id).first()
            if record is None:
                record = EmbeddingRecord(
                    patent_id=embedding_dto.patent_id,
                    embedding=embedding_dto.embedding,
                    model_name=embedding_dto.model_name,
                )
                session.add(record)
            else:
                record.embedding = embedding_dto.embedding
                record.model_name = embedding_dto.model_name
            session.commit()
        except Exception as ex:
            session.rollback()

            raise EmbeddingRepositoryException(
                f"Failed to store embedding for patent '{embedding_dto.patent_id}'."
            ) from ex
        finally:
            session.close()

    def get_embedding(self, patent_id: int) -> Optional[EmbeddingDTO]:
        """Read a cached embedding by patent id and return it as an EmbeddingDTO."""
        session = self._get_session()
        try:
            record = session.query(EmbeddingRecord).filter_by(patent_id=patent_id).first()
            if record is None:
                return None

            embedding_list = record.embedding

            # if isinstance(embedding_value, str):
            #     embedding_value = json.loads(embedding_value)
            # embedding_list = embedding_value if isinstance(embedding_value, list) else []
            
            return EmbeddingDTO(
                patent_id=record.patent_id,
                embedding=embedding_list,
                model_name=record.model_name or "default-model",
            )
        except Exception as ex:
            raise EmbeddingRepositoryException(
                f"Failed to retrieve embedding for patent '{patent_id}'."
            ) from ex
        finally:
            session.close()

    def delete_embedding(self, patent_id: int) -> bool:
        """Delete a cached embedding if it exists."""
        session = self._get_session()
        try:
            record = session.query(EmbeddingRecord).filter_by(patent_id=patent_id).first()
            if record is None:
                return False
            session.delete(record)
            session.commit()
            return True
        except Exception as ex:
            session.rollback()
            raise EmbeddingRepositoryException(
                f"Failed deleting embedding for patent '{patent_id}'."
            ) from ex
        finally:
            session.close()
