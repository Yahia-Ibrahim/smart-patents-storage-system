from __future__ import annotations

import os

from confluent_kafka import Consumer
from dotenv import load_dotenv


load_dotenv()

BOOTSTRAP_SERVERS = os.getenv(
    "KAFKA_BOOTSTRAP_SERVERS",
    "localhost:9092",
)

TOPIC = os.getenv(
    "REPORT_TOPIC",
    "Notifications.similarity-report",
)

GROUP_ID = os.getenv(
    "REPORT_CONSUMER_GROUP",
    "notification-test-consumer",
)


def main():
    consumer = Consumer(
        {
            "bootstrap.servers": BOOTSTRAP_SERVERS,
            "group.id": GROUP_ID,
            "auto.offset.reset": "earliest",
        }
    )

    consumer.subscribe([TOPIC])

    print(
        f"[INFO] Listening for reports on '{TOPIC}'..."
    )

    try:
        while True:
            message = consumer.poll(1.0)

            if message is None:
                continue

            if message.error():
                print(
                    f"[ERROR] Kafka error: {message.error()}"
                )
                continue

            print(
                "\n[REPORT RECEIVED]"
            )
            print(
                f"topic     : {message.topic()}"
            )
            print(
                f"partition : {message.partition()}"
            )
            print(
                f"offset    : {message.offset()}"
            )
            print(
                f"value     : {message.value().decode('utf-8')}"
            )

    except KeyboardInterrupt:
        print("\n[INFO] Consumer stopped.")

    finally:
        consumer.close()


if __name__ == "__main__":
    main()