import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEventType, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, defer, map } from 'rxjs';
import { ApiClient } from './api-client.service';
import { MediaFile } from '../models';

export type UploadStage = 'queued' | 'uploading' | 'done' | 'error';

export interface UploadProgress {
  stage: UploadStage;
  /** 0–100 — only meaningful during `uploading`. */
  percent: number;
  /** Populated on `done`. */
  result?: MediaFile | MediaFile[] | ProductImageUploadResult;
  /** Populated on `error`. */
  error?: string;
}

export interface ProductImageUploadResult {
  productId: string;
  uploaded: number;
  /** Full ordered list of image URLs after the upload. */
  images: string[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

const ACCEPTED_TYPES = /^(image\/(jpeg|png|webp|gif|avif)|model\/gltf-binary|application\/octet-stream)$/i;
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Cloud-storage upload service. Speaks multipart to the Express API which
 * proxies to the configured storage driver (disk locally, S3/Supabase in
 * prod). Returns a hot observable of progress events per call so the UI
 * can render real progress bars.
 */
@Injectable({ providedIn: 'root' })
export class MediaUploadService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiClient);

  /** Validates a File against the same rules the server enforces, locally
      so the UI can reject obvious mismatches without a round-trip. */
  validate(file: File): string | null {
    const isGlb = (file.name || '').toLowerCase().endsWith('.glb');
    if (!isGlb && !ACCEPTED_TYPES.test(file.type)) {
      return `Unsupported file type: ${file.type || 'unknown'}`;
    }
    if (file.size > MAX_SIZE_BYTES) {
      return `File exceeds the 50 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`;
    }
    return null;
  }

  /** Upload one or more files into the media library. */
  uploadMedia(files: File[]): Observable<UploadProgress> {
    return this.uploadMultipart<MediaFile[]>('/admin/media', files);
  }

  /** Upload images for a specific product — they're appended to the gallery
      and the first one becomes primary if the product had no thumbnail. */
  uploadProductImages(productId: string, files: File[]): Observable<UploadProgress> {
    return this.uploadMultipart<ProductImageUploadResult>(`/admin/products/${productId}/images`, files);
  }

  private uploadMultipart<T>(path: string, files: File[]): Observable<UploadProgress> {
    return defer(() => {
      const form = new FormData();
      for (const file of files) {
        form.append('files', file, file.name);
      }
      const req = new HttpRequest('POST', this.api.url(path), form, {
        reportProgress: true,
        withCredentials: true,
      });
      return this.http.request<ApiEnvelope<T>>(req).pipe(
        map((event): UploadProgress => {
          if (event.type === HttpEventType.UploadProgress) {
            const total = event.total || 1;
            return {
              stage: 'uploading',
              percent: Math.min(100, Math.round((event.loaded / total) * 100)),
            };
          }
          if (event.type === HttpEventType.Response) {
            const body = (event as HttpResponse<ApiEnvelope<T>>).body;
            return {
              stage: 'done',
              percent: 100,
              result: body?.data as MediaFile | MediaFile[] | ProductImageUploadResult,
            };
          }
          return { stage: 'queued', percent: 0 };
        }),
      );
    });
  }
}
