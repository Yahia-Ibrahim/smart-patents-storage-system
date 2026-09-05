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
        "eventId": "test-approval-005",
        "patentId": 1005,
        "title": "Roadside-Cooperative Autonomous Driving: From Data Platform to Vision-Language End-to-End Reasoning",
        "applicationNumber": "PAT-2026-0005",
        "fileUrl": "https://arxiv.org/pdf/2608.21032",
        "submittedBy": 43,
        "submittedAt": "2026-08-21T01:00:30",
        "abstract": "Vehicle-to-Everything (V2X) cooperation enables beyond-line-of-sight perception, mitigating occlusions in single-vehicle sensing. However, existing V2X benchmarks provide limited support for closed-loop evaluation and language-grounded supervision, hindering the development of vision-language models (VLMs) for end-to-end cooperative driving. To address these limitations, we introduce V2XBench, a simulation platform featuring synchronized ego--roadside sensing and closed-loop evaluation, together with Chat-V2XBench, a progressively structured VQA dataset for cooperative reasoning. Building upon this benchmark infrastructure, we propose AURORA, an end-to-end cooperative driving framework. Equipped with a dual-view perception architecture, AURORA mitigates spatial and semantic discrepancies across ego and roadside viewpoints through a query-level Cross-View Query Alignment and Fusion (CQAF) module. Leveraging the resulting unified tokens, a LoRA-adapted VLM bridges semantic reasoning and generative trajectory planning. Extensive closed-loop evaluations on V2XBench demonstrate that AURORA achieves state-of-the-art performance in heavily occluded scenarios, with a Route Completion rate of 98.21% and a Driving Score of 76.02, while requiring low roadside communication bandwidth. Ultimately, this work pioneers an extensible V2X--VLM paradigm, paving the way for next-generation cooperative autonomous driving."
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