"""
Kafka producer for notification events.
"""

from __future__ import annotations

import json
import os

from confluent_kafka import Producer

from app.models.dto import SimilarityReportDTO


class NotificationProducer:
    """
    Publishes notification events to Kafka.
    """

    REPORT_TOPIC = os.getenv(
        "REPORT_TOPIC",
        "Notifications.similarity-report",
    )

    def __init__(self, producer: Producer | None = None):
        self.producer = producer or self._build_producer()

    def _build_producer(self) -> Producer:
        config = {
            "bootstrap.servers": os.getenv(
                "KAFKA_BOOTSTRAP_SERVERS",
                "localhost:9092",
            )
        }

        return Producer(config)

    def publish_similarity_report(
        self,
        report: SimilarityReportDTO,
    ) -> None:
        """
        Publish a similarity report for the notification service.
        """

        self.producer.produce(
            topic=self.REPORT_TOPIC,
            value=report.model_dump_json(),
        )

        self.producer.flush()