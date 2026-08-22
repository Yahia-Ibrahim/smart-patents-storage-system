import json

from app.consumers.kafka_consumer import KafkaPatentConsumer
from app.models.dto import PatentApprovedEventDTO, PatentRejectedEventDTO, PatentSubmittedEventDTO


class DummyIndexingService:
    def __init__(self):
        self.calls = []

    def index_patent(self, payload):
        self.calls.append(("submitted", payload))

    def approve_patent(self, payload):
        self.calls.append(("approved", payload))

    def reject_patent(self, payload):
        self.calls.append(("rejected", payload))


def test_process_message_dispatches_to_expected_handlers():
    service = DummyIndexingService()
    consumer = KafkaPatentConsumer(indexing_service=service)

    payload = {
        "eventId": "evt-123",
        "patentId": 143,
        "title": "Neural Traffic Prediction for Smart Cities",
        "applicationNumber": "US-2026-001234",
        "fileUrl": "https://minio/patents/143.pdf",
        "submittedBy": 17,
        "submittedAt": "2026-07-18T10:15:00Z",
    }

    submitted_dto = PatentSubmittedEventDTO.model_validate(payload)
    approved_dto = PatentApprovedEventDTO.model_validate(payload)
    rejected_dto = PatentRejectedEventDTO.model_validate(payload)

    consumer.process_message("Patents.submitted", payload)
    consumer.process_message("Patents.approved", payload)
    consumer.process_message("Patents.rejected", payload)

    assert service.calls == [
        ("submitted", submitted_dto),
        ("approved", approved_dto),
        ("rejected", rejected_dto),
    ]


def test_consume_messages_polls_and_dispatches_to_service():
    class DummyKafkaMessage:
        def __init__(self, topic, value):
            self._topic = topic
            self._value = value
            self._error = None

        def topic(self):
            return self._topic

        def value(self):
            return self._value

        def error(self):
            return self._error

    class DummyKafkaConsumer:
        def __init__(self, messages):
            self.messages = list(messages)
            self.subscribed_topics = None

        def subscribe(self, topics):
            self.subscribed_topics = topics

        def poll(self, timeout=1.0):
            if not self.messages:
                return None
            return self.messages.pop(0)

        def close(self):
            return None

    payload = {
        "eventId": "evt-321",
        "patentId": 99,
        "title": "IoT Patent",
        "applicationNumber": "US-999",
        "fileUrl": "https://minio/patents/99.pdf",
        "submittedBy": 1,
        "submittedAt": "2026-07-18T10:15:00Z",
    }
    message = DummyKafkaMessage("Patents.submitted", json.dumps(payload).encode("utf-8"))
    dummy_consumer = DummyKafkaConsumer([message])
    service = DummyIndexingService()
    consumer = KafkaPatentConsumer(indexing_service=service, consumer=dummy_consumer)

    consumer.consume_messages(timeout=0.01, max_messages=1)

    assert service.calls == [("submitted", payload)]
    assert dummy_consumer.subscribed_topics == list(KafkaPatentConsumer.TOPIC_HANDLERS.keys())
