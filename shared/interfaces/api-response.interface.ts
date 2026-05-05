/**
 * Generic API response wrapper — mirrors the shape the Express server returns.
 * Import with: import { ApiResponse, PaginatedResponse } from '@shared/interfaces/api-response.interface';
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: string[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
  meta: PaginationMeta;
}
