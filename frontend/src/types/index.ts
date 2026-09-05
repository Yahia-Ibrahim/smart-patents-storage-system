// Domain and API types. These mirror the backend DTOs in src/utils/dto.js.

export type Role = 'user' | 'admin';

export interface InventorProfile {
  id: string;
  fullName: string;
  email: string;
  organization: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser extends User {
  createdBy: string | null;
}

export interface Profile extends User {
  inventorProfile: InventorProfile | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens {
  user: User;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserListResult {
  users: AdminUser[];
  pagination: Pagination;
}

// The backend's uniform envelope.
export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; error: ApiError };
export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

/* ------------------------------------------------------------------------- *
 * Patents
 * ------------------------------------------------------------------------- */

/**
 * `pending_ai` is reserved in the schema and deliberately unimplemented — the
 * AI service is advisory and gates nothing, so a patent never enters it. It is
 * listed because the API's filter accepts it and a record could in principle
 * carry it; the UI must not crash on a status it has never seen.
 */
export type PatentStatus = 'draft' | 'pending_ai' | 'pending_admin' | 'approved' | 'declined';

/** A person on a patent. `email` is present only for an admin or the owner. */
export interface Party {
  id: string;
  name: string;
  email?: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface Inventor {
  id: string;
  fullName: string;
  email?: string;
  organization: string | null;
}

export interface PatentInventor extends Inventor {
  /** Contiguous 1..N across the patent; the API rejects gaps. */
  order: number;
}

export interface InventorDetail extends Inventor {
  linkedUser: Party | null;
  createdAt: string;
}

export interface InventorListResult {
  inventors: InventorDetail[];
  pagination: Pagination;
}

/** List shape. The API omits `specification` here — a page of full bodies. */
export interface Patent {
  id: string;
  title: string;
  abstract: string;
  status: PatentStatus;
  version: number;
  publicationNumber: string | null;
  jurisdiction: string | null;
  submittedBy: string;
  submitter?: Party | null;
  categories: Category[];
  inventors: PatentInventor[];
  hasDocument: boolean;
  /**
   * The AI's headline similarity, or null. Null covers three cases the UI can
   * treat alike: the viewer may not see review data (it is owner-or-admin, like
   * the reviews endpoint), the AI has not reported yet, or it reported and
   * found nothing — in which case the object is present with a null `score`.
   */
  aiSimilarity: { score: number | null; analysedAt: string } | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatentDetail extends Patent {
  specification: string;
  documentKey: string | null;
}

export interface PatentListResult {
  patents: Patent[];
  pagination: Pagination;
}

/**
 * A review row. Two stages share this shape:
 *
 *   admin_review — a human decision, with a reviewer and a pass/fail.
 *   ai_filter    — the AI service's similarity report, arriving over Kafka. It
 *                  has no reviewer and no decision on purpose: the AI is
 *                  advisory and gates nothing. Its findings are JSON in
 *                  `comments`; see `parseAiReport`.
 */
export type ReviewStage = 'admin_review' | 'ai_filter';

export interface PatentReview {
  id: string;
  patentId: string;
  stage: ReviewStage;
  decision: 'pass' | 'fail' | null;
  /** Top match similarity, as a percentage — the column is Decimal(5,2). */
  aiConfidenceScore: number | null;
  comments: string | null;
  reviewer: Party | null;
  createdAt: string;
}

/** One prior-art hit inside an `ai_filter` review's JSON comments. */
export interface AiSimilarityMatch {
  patentId: string;
  title: string;
  /** Raw cosine similarity, 0..1 — not the percentage on the review row. */
  score: number;
}

export interface AiSimilarityReport {
  matchCount: number;
  matches: AiSimilarityMatch[];
}

export interface UploadTarget {
  uploadUrl: string;
  objectKey: string;
  contentType: string;
  maxBytes: number;
  expiresAt: string;
}

export interface DocumentLink {
  downloadUrl: string;
  expiresAt: string;
}

/** A hit from POST /patents/search: the live patent plus the AI's reasoning. */
export interface SearchMatch {
  patent: Patent;
  explanation: string | null;
}

export interface SearchResult {
  summary: string;
  results: SearchMatch[];
}

export interface CategoryListResult {
  categories: Category[];
}
