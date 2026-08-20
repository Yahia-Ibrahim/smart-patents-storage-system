const crypto = require('crypto');

/**
 * The contract between this service and the Search Service.
 *
 * These are **fat events** (event-carried state transfer): the payload carries
 * everything a consumer needs to index a patent, so the Search Service never
 * calls back here. That is what lets the two sides be deployed, scaled, and
 * broken independently — the only coupling between them is this shape.
 *
 * Treat it as a published interface. Adding optional fields is safe; renaming
 * or removing one is a breaking change that needs a version bump and a
 * migration window on the consumer side.
 */

const AGGREGATE_TYPE = 'patent';

const EVENT_TYPES = Object.freeze({
  UPSERTED: 'PatentVersionUpserted',
  WITHDRAWN: 'PatentVersionWithdrawn',
});

/**
 * Emitted when a patent version becomes part of the searchable corpus, i.e. on
 * approval. Deliberately *not* on submission: indexing unreviewed text would
 * put content into the corpus that an admin may be about to reject.
 *
 * `patent` must include its `categories.category` and `inventors.inventor`
 * relations — see patentService.PATENT_INCLUDE.
 */
const patentVersionUpserted = (patent) => ({
  event_type: EVENT_TYPES.UPSERTED,
  event_id: crypto.randomUUID(),
  patent_id: String(patent.id),
  version: patent.version,
  title: patent.title,
  abstract: patent.abstract,
  specification: patent.specification,
  publication_number: patent.publicationNumber ?? null,
  jurisdiction: patent.jurisdiction ?? null,
  categories: (patent.categories || []).map((link) => link.category.name),
  inventors: (patent.inventors || [])
    .slice()
    .sort((a, b) => a.inventorOrder - b.inventorOrder)
    .map((link) => ({
      id: String(link.inventor.id),
      full_name: link.inventor.fullName,
      organization: link.inventor.organization ?? null,
      order: link.inventorOrder,
    })),
  document_key: patent.documentKey ?? null,
  submitted_by: String(patent.submittedBy),
  occurred_at: new Date().toISOString(),
});

/**
 * Emitted when a patent leaves the corpus — declined after approval, or
 * deleted. Without this a consumer's projection would keep serving content the
 * source of truth no longer considers public.
 */
const patentVersionWithdrawn = (patent, reason) => ({
  event_type: EVENT_TYPES.WITHDRAWN,
  event_id: crypto.randomUUID(),
  patent_id: String(patent.id),
  version: patent.version,
  reason,
  occurred_at: new Date().toISOString(),
});

module.exports = { AGGREGATE_TYPE, EVENT_TYPES, patentVersionUpserted, patentVersionWithdrawn };
