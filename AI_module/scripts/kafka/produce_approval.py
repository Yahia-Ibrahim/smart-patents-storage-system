from __future__ import annotations

import json
import os

from confluent_kafka import Producer
from dotenv import load_dotenv


load_dotenv()

BOOTSTRAP_SERVERS = os.getenv(
    "KAFKA_BOOTSTRAP_SERVERS",
    "localhost:9092",
)

TOPIC = os.getenv(
    "PATENT_APPROVED_TOPIC",
    "Patents.approved",
)


def delivery_report(err, message):
    if err is not None:
        print(
            f"[ERROR] Failed to publish event: {err}"
        )
        return

    print(
        "[SUCCESS] Patent approval event published "
        f"to {message.topic()} "
        f"[partition={message.partition()}, "
        f"offset={message.offset()}]"
    )


def main():
    producer = Producer(
        {
            "bootstrap.servers": BOOTSTRAP_SERVERS,
        }
    )

    # event = {
    #     "eventId": "test-approval-001",
    #     "patentId": 1001,
    #     "title": "AI-based adaptive vehicle control system",
    #     "applicationNumber": "PAT-2026-0001",
    #     "fileUrl": "https://patentimages.storage.googleapis.com/5b/d3/99/d524b76163ab96/US5189619.pdf",
    #     "submittedBy": 42,
    #     "submittedAt": "2026-08-21T01:00:00",
    # }
    event = {
        "eventId": "test-approval-002",
        "patentId": 1002,
        "title": "Control Analysis and Design for Autonomous Vehicles Subject to Imperfect AI-Based Perception",
        "applicationNumber": "PAT-2026-0002",
        "fileUrl": "https://arxiv.org/pdf/2509.12137",
        "submittedBy": 43,
        "submittedAt": "2026-08-21T01:00:30",
    }

    print("[INFO] Publishing patent approval event:")
    print(json.dumps(event, indent=2))

    producer.produce(
        topic=TOPIC,
        key=str(event["patentId"]),
        value=json.dumps(event),
        callback=delivery_report,
    )

    producer.flush()


if __name__ == "__main__":
    main()