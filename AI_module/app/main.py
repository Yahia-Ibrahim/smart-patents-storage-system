from __future__ import annotations

from app.consumers.kafka_consumer import KafkaPatentConsumer

from app.repositories.embedding_repository import EmbeddingRepository

from app.services.document_extractor import DocumentExtractor
from app.services.embedding_service import EmbeddingService
from app.services.indexing_service import IndexingService
from app.producers.notification_producer import NotificationProducer
from app.services.report_generator import ReportGenerator
from app.services.similarity_engine import SimilarityEngine
from app.services.vector_store_service import VectorStoreService
from app.database.database import init_db

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)



def build_indexing_service() -> IndexingService:
    """
    Build the dependency graph for the indexing service.
    """

    vector_store = VectorStoreService()

    return IndexingService(
        document_extractor=DocumentExtractor(),
        embedding_service=EmbeddingService(),
        vector_store_service=vector_store,
        embedding_repository=EmbeddingRepository(),
        similarity_engine=SimilarityEngine(vector_store),
        report_generator=ReportGenerator(),
        notification_producer=NotificationProducer(),
    )


def main() -> None:

    init_db()

    indexing_service = build_indexing_service()

    consumer = KafkaPatentConsumer(
        indexing_service=indexing_service,
    )

    consumer.start()

    consumer.consume_messages()


if __name__ == "__main__":
    main()