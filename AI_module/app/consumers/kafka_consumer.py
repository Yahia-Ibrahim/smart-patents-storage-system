"""Kafka consumer entry points for patent lifecycle events."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

from confluent_kafka import Consumer

from app.models.dto import PatentApprovedEventDTO, PatentRejectedEventDTO, PatentSubmittedEventDTO

import logging

logger = logging.getLogger(__name__)

class KafkaPatentConsumer:
    """Subscribe to patent lifecycle topics and forward messages to the indexing service."""

    TOPIC_HANDLERS = {
        "Patents.submitted": "handle_patent_submitted",
        "Patents.approved": "handle_patent_approved",
        "Patents.rejected": "handle_patent_rejected",
    }

    def __init__(self, indexing_service: Optional[Any] = None, consumer: Optional[Any] = None):
        self.indexing_service = indexing_service
        self.consumer = consumer

    def _build_consumer(self) -> Consumer:
        """Create a Kafka consumer configured for the patent topics."""
        config = {
            "bootstrap.servers": os.getenv(
                "KAFKA_BOOTSTRAP_SERVERS",
                "localhost:9092",
            ),
            "group.id": "ai-service-patents",
            "auto.offset.reset": "earliest",
            "enable.auto.commit": True,
        }
        return Consumer(config)

    def start(self, topics: Optional[list[str]] = None) -> None:
        """Subscribe to the configured topics and prepare the consumer."""
        if self.consumer is None:
            self.consumer = self._build_consumer()

        subscribed_topics = list(topics or self.TOPIC_HANDLERS.keys())
        self.consumer.subscribe(subscribed_topics)

    def process_message(self, topic: str, payload: Dict[str, Any]) -> Any:
        """Dispatch a Kafka payload to the appropriate handler."""
        if not isinstance(payload, dict):
            raise TypeError("payload must be a dictionary")

        handler_name = self.TOPIC_HANDLERS.get(topic)
        if handler_name is None:
            raise ValueError(f"Unsupported topic: {topic}")

        dto_map = {
            "Patents.submitted": PatentSubmittedEventDTO,
            "Patents.approved": PatentApprovedEventDTO,
            "Patents.rejected": PatentRejectedEventDTO,
        }
        dto_cls = dto_map.get(topic)
        parsed_payload = dto_cls.model_validate(payload) if dto_cls is not None else payload

        handler = getattr(self, handler_name)
        return handler(parsed_payload)

    def consume_messages(self, timeout: float = 1.0, max_messages: Optional[int] = None) -> list[Any]:
        """Poll Kafka for messages and forward each one to the indexing service."""
        # if self.consumer is None:
        #     self.start()
        # else:
        self.start()

        results = []
        count = 0
        while max_messages is None or count < max_messages:
            msg = self.consumer.poll(timeout=timeout)
            if msg is None:
                continue                
            if msg.error():
                continue

            body = msg.value()
            topic = msg.topic()
            
            if isinstance(body, (bytes, bytearray)):
                try:
                    payload = json.loads(body.decode("utf-8"))
                except json.JSONDecodeError:
                    payload = {"raw": body.decode("utf-8")}
            else:
                payload = body

            if not isinstance(payload, dict):
                payload = {"raw": payload}

            # print(f"[INFO] Received Kafka message from {topic}: {payload}")
            logger.info("Received Kafka message from %s: %s", topic, payload)

            try:
                processed = self.process_message(topic, payload)

            except Exception:
                logger.exception(
                    "Failed processing message from topic %s",
                    topic
                )
                continue
            results.append(processed)
            count += 1

        return results

    def handle_patent_submitted(self, payload: PatentSubmittedEventDTO) -> Any:
        """Handle a submitted-patent event."""
        if self.indexing_service is None:
            return None
        return self.indexing_service.handle_submitted_patent(payload)

    def handle_patent_approved(self, payload: PatentApprovedEventDTO) -> Any:
        """Handle an approved-patent event."""
        if self.indexing_service is None:
            return None
        return self.indexing_service.handle_approved_patent(payload)

    def handle_patent_rejected(self, payload: PatentRejectedEventDTO) -> Any:
        """Handle a rejected-patent event."""
        if self.indexing_service is None:
            return None
        return self.indexing_service.handle_rejected_patent(payload)
