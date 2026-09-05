import type { Category, CategoryListResult, InventorDetail, InventorListResult } from '@/types';
import { apiClient } from './apiClient';

/**
 * Categories and inventors — the two lookup tables a patent links to.
 *
 * Both are readable by any signed-in user, because the patent form has to offer
 * them. Writing differs: anyone may create an inventor (you cannot file a
 * patent without naming one), while only an admin may create a category, since
 * the taxonomy is shared.
 */
export const catalogService = {
  listCategories(search?: string, signal?: AbortSignal): Promise<CategoryListResult> {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return apiClient.get<CategoryListResult>(`/categories${qs}`, { signal });
  },

  createCategory(name: string): Promise<Category> {
    return apiClient.post<Category>('/categories', { name });
  },

  listInventors(
    params: { page?: number; limit?: number; search?: string } = {},
    signal?: AbortSignal,
  ): Promise<InventorListResult> {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.search) q.set('search', params.search);
    const qs = q.toString();
    return apiClient.get<InventorListResult>(`/inventors${qs ? `?${qs}` : ''}`, { signal });
  },

  /**
   * `linkToMe` attaches the new inventor record to the caller's account, which
   * is what makes their own email visible back to them afterwards. Only
   * meaningful when the user is adding themselves.
   */
  createInventor(input: {
    fullName: string;
    email: string;
    organization?: string;
    linkToMe?: boolean;
  }): Promise<InventorDetail> {
    return apiClient.post<InventorDetail>('/inventors', input);
  },
};
