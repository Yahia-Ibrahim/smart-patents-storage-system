const crypto = require('crypto');
const config = require('../config/env');

/**
 * The contract with the AI service (`AI_module/`).
 *
 * Deliberately separate from `patentEvents.js`. That file is the fat
 * event-carried-state contract with the future Search Service; this one is a
 * flat, minimal shape that the AI service's pydantic DTOs already parse
 * (`app/models/dto.py: PatentEventDTO`). They describe the same domain moments
 * but are different published interfaces with different owners, and folding
 * them together would mean a change requested by one consumer silently breaks
 * the other.
 *
 * **The backend adapts, not the AI service.** The AI service is owned by
 * another team; matching the shape it already reads is what keeps this
 * integration to a single method's worth of change on their side.
 *
 * Field names are camelCase here — matching the AI DTO — where the rest of this
 * codebase's events use snake_case. That mismatch is the point: this is their
 * vocabulary, not ours.
 */

const EVENT_TYPES = Object.freeze({
  SUBMITTED: 'PatentSubmitted',
  APPROVED: 'PatentApproved',
  REJECTED: 'PatentRejected',
});

/**
 * `patentId` and `submittedBy` are `int` in the AI's DTO, but ids here are
 * BigInt. Number() is exact below 2^53; ids are autoincrement and will not
 * reach that, but a silent wrong id downstream is bad enough to be worth the
 * explicit check.
 */
const toInt = (id) => {
  const value = Number(id);

  if (!Number.isSafeInteger(value)) {
    throw new Error(`Id ${id} exceeds the safe integer range the AI service accepts`);
  }

  return value;
};

/**
 * Where the AI service fetches the document from.
 *
 * An `s3://bucket/key` URI, not a presigned HTTPS URL. A presigned URL would
 * expire while the event sat in the outbox or on the topic, so any AI outage
 * longer than the TTL would leave events that can never be processed — the
 * retry would fetch a dead link forever. A URI names the object for as long as
 * the object exists, and the AI service resolves it with its own credentials.
 */
const documentUri = (documentKey) =>
  documentKey ? `s3://${config.storage.bucket}/${documentKey}` : '';

/**
 * The payload every AI event shares.
 *
 * `applicationNumber` and `submittedAt` are required (non-optional `str`) in
 * the AI DTO but nullable here, so both get fallbacks rather than the DTO being
 * loosened — nothing in the AI service actually reads `applicationNumber`
 * (every use of it is commented out), so a placeholder costs nothing and saves
 * a change to their code.
 *
 * `abstract` is optional on their side and easy to mistake for decoration, but
 * it is what the new search feature reads. On approval it becomes the Qdrant
 * payload's `abstract`, which LangChain is configured to use as the document's
 * `page_content` (`content_payload_key="abstract"`), and the explanation prompt
 * is told to ground every match in it. Omit it and search still finds the right
 * patents, but every explanation reads "no abstract was available to confirm
 * the overlap".
 */
const basePayload = (patent) => ({
  eventId: crypto.randomUUID(),
  patentId: toInt(patent.id),
  title: patent.title,
  applicationNumber: patent.publicationNumber ?? `PENDING-${patent.id}`,
  fileUrl: documentUri(patent.documentKey),
  submittedBy: toInt(patent.submittedBy),
  submittedAt: (patent.submittedAt ?? patent.createdAt ?? new Date()).toISOString(),
  abstract: patent.abstract ?? null,
});

/**
 * Emitted when a patent enters admin review.
 *
 * This is the event the AI service's similarity report keys off, and the reason
 * the backend now emits on submission at all — `patentEvents.js` deliberately
 * does not, because indexing unreviewed text would put it in the search corpus.
 * That reasoning does not apply here: the AI service only *caches* an embedding
 * on submit and searches with it. Nothing enters the corpus until approval.
 */
const patentSubmitted = (patent) => basePayload(patent);

/** Emitted on approval — the moment the patent joins the similarity corpus. */
const patentApproved = (patent) => basePayload(patent);

/**
 * Emitted on decline, from any prior status.
 *
 * Broader than `patentVersionWithdrawn`, which only fires for approved →
 * declined because only an approved patent was ever in the search corpus. The
 * AI service caches an embedding from the *submitted* event, so a patent
 * declined without ever being approved still has state there to clean up.
 */
const patentRejected = (patent) => basePayload(patent);

/**
 * Topic per event type. The AI service subscribes to these three names
 * literally (`KafkaPatentConsumer.TOPIC_HANDLERS`), so they are configuration
 * only in the sense that both sides must be changed together.
 */
const topicFor = (eventType) =>
  ({
    [EVENT_TYPES.SUBMITTED]: config.kafka.aiSubmittedTopic,
    [EVENT_TYPES.APPROVED]: config.kafka.aiApprovedTopic,
    [EVENT_TYPES.REJECTED]: config.kafka.aiRejectedTopic,
  })[eventType];

module.exports = {
  EVENT_TYPES,
  documentUri,
  patentSubmitted,
  patentApproved,
  patentRejected,
  topicFor,
};
