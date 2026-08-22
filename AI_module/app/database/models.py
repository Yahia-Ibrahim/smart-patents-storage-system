from __future__ import annotations

from sqlalchemy import JSON, Column, Integer, String
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class EmbeddingRecord(Base):
    __tablename__ = "embeddings"

    # id = Column(Integer, primary_key=True, index=True)
    patent_id = Column(Integer, primary_key=True, index=True)
    embedding = Column(JSON, nullable=False)
    model_name = Column(String(128), nullable=False, default="default-model")
    # title = Column(String(512), nullable=True)
    submitted_at = Column(String(64), nullable=True)


class AdminRecord(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, unique=True)
    email = Column(String(255), nullable=False, unique=True)
