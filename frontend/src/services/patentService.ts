import type {
  DocumentLink,
  Patent,
  PatentDetail,
  PatentListResult,
  PatentReview,
  PatentStatus,
  SearchResult,
  UploadTarget,
} from '@/types';
import { apiClient, ApiClientError } from './apiClient';

export interface ListPatentsParams {
  page?: number;
  limit?: number;
  status?: PatentStatus;
  categoryId?: string;
  submittedBy?: string;
  jurisdiction?: string;
  search?: string;
}

export interface PatentInput {
  title: string;
  abstract: string;
  specification: string;
  documentKey?: string;
  publicationNumber?: string | null;
  jurisdiction?: string | null;
  categoryIds?: string[];
  inventors?: { inventorId: string; order?: number }[];
}

const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') q.set(key, String(value));
  }
  const qs = q.toString();
  return qs ? `?${qs}` : '';
};

/**
 * Uploads bytes straight to object storage using a presigned PUT.
 *
 * Deliberately not `apiClient`: this request does not go to our API at all, and
 * must not carry the Authorization header — the signature is in the URL, and an
 * extra auth header changes the signed request and gets rejected. `fetch` is
 * used raw for the same reason there is no envelope to unwrap.
 *
 * `Content-Type` has to match what the presign was issued for exactly: the
 * backend signs it in, so a browser guessing a different type invalidates the
 * signature rather than uploading the wrong thing.
 */
async function putToPresignedUrl(target: UploadTarget, file: File): Promise<void> {
  let response: Response;

  try {
    response = await fetch(target.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': target.contentType },
      body: file,
    });
  } catch {
    // The most common cause is an endpoint the browser cannot reach — the
    // backend signing with a hostname only its own network resolves. Worth
    // naming, because the browser reports it as an opaque network error.
    throw new ApiClientError(
      0,
      'UPLOAD_NETWORK',
      'Could not reach document storage. If the server is running in Docker, check that S3_PUBLIC_ENDPOINT points somewhere your browser can reach.',
    );
  }

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      'UPLOAD_FAILED',
      `Storage rejected the upload (${response.status}). The link may have expired — try again.`,
    );
  }
}

export const patentService = {
  list(params: ListPatentsParams = {}, signal?: AbortSignal): Promise<PatentListResult> {
    return apiClient.get<PatentListResult>(`/patents${query({ ...params })}`, { signal });
  },

  get(id: string, signal?: AbortSignal): Promise<PatentDetail> {
    return apiClient.get<PatentDetail>(`/patents/${id}`, { signal });
  },

  create(input: PatentInput): Promise<PatentDetail> {
    return apiClient.post<PatentDetail>('/patents', input);
  },

  update(id: string, input: Partial<PatentInput>): Promise<PatentDetail> {
    return apiClient.patch<PatentDetail>(`/patents/${id}`, input);
  },

  remove(id: string): Promise<{ message: string }> {
    return apiClient.del<{ message: string }>(`/patents/${id}`);
  },

  /** Draft -> pending_admin. The API decides whether the move is legal. */
  submit(id: string): Promise<PatentDetail> {
    return apiClient.post<PatentDetail>(`/patents/${id}/submit`);
  },

  approve(id: string, comments?: string): Promise<PatentDetail> {
    return apiClient.post<PatentDetail>(`/patents/${id}/approve`, { comments: comments || undefined });
  },

  /** Comments are required here, unlike approve: a decline has to say why. */
  decline(id: string, comments: string): Promise<PatentDetail> {
    return apiClient.post<PatentDetail>(`/patents/${id}/decline`, { comments });
  },

  reviews(id: string, signal?: AbortSignal): Promise<{ reviews: PatentReview[] }> {
    return apiClient.get<{ reviews: PatentReview[] }>(`/patents/${id}/reviews`, { signal });
  },

  documentLink(id: string): Promise<DocumentLink> {
    return apiClient.get<DocumentLink>(`/patents/${id}/document`);
  },

  /**
   * The full upload: ask our API for a target, then PUT the bytes to storage.
   *
   * Returns the object key, which is what `documentKey` on create/update wants.
   * Bytes never pass through our API — the key is the only thing that comes
   * back through it.
   */
  async uploadDocument(file: File): Promise<string> {
    const target = await apiClient.post<UploadTarget>('/patents/uploads', {
      filename: file.name,
      contentType: file.type || 'application/pdf',
    });

    // Checked before the PUT purely to fail fast with a useful message: the
    // real limit is enforced server-side on the way back in, since a presigned
    // PUT cannot express a maximum length.
    if (file.size > target.maxBytes) {
      throw new ApiClientError(
        400,
        'FILE_TOO_LARGE',
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${(
          target.maxBytes /
          1024 /
          1024
        ).toFixed(0)} MB.`,
      );
    }

    await putToPresignedUrl(target, file);

    return target.objectKey;
  },

  /** Semantic prior-art search. 503 means the AI service is down, not a bug. */
  searchSemantic(text: string, signal?: AbortSignal): Promise<SearchResult> {
    return apiClient.post<SearchResult>('/patents/search', { text }, { signal });
  },
};

/** Convenience for callers that only need to know "can this still be edited". */
export const isEditable = (patent: Pick<Patent, 'status'>) =>
  patent.status === 'draft' || patent.status === 'declined';
