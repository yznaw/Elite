import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { MediaFile } from '../models';

@Injectable({ providedIn: 'root' })
export class AdminMediaService {
  private readonly api = inject(ApiClient);

  list(): Promise<MediaFile[]> {
    return firstValueFrom(this.api.get<MediaFile[]>('/admin/media')).then(files =>
      files.map(f => this.normalizeFile(f)),
    );
  }

  link(id: string, productId: string | null, role: string = 'gallery'): Promise<void> {
    return firstValueFrom(
      this.api.patch<{ id: string }>(`/admin/media/${id}/link`, { productId, role }),
    ).then(() => undefined);
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.api.delete<{ id: string }>(`/admin/media/${id}`)).then(() => undefined);
  }

  deleteOrphaned(): Promise<{ deleted: number }> {
    return firstValueFrom(this.api.delete<{ deleted: number }>('/admin/media/orphaned'));
  }

  /** Import image files from a publicly-shared Google Drive file or folder URL. */
  importFromGDrive(driveUrl: string): Promise<MediaFile[]> {
    return firstValueFrom(
      this.api.post<MediaFile[]>('/admin/media/gdrive', { url: driveUrl }),
    ).then(files => files.map(f => this.normalizeFile(f)));
  }

  /** Load the current default fallback image URL from store settings. */
  getDefaultImage(): Promise<string | null> {
    return firstValueFrom(
      this.api.get<{ config?: { defaultImage?: string } }>('/admin/settings/store'),
    ).then(r => r?.config?.defaultImage ?? null).catch(() => null);
  }

  /** Save a media URL as the store-wide default fallback image. */
  setDefaultImage(url: string): Promise<void> {
    return firstValueFrom(
      this.api.patch<unknown>('/admin/settings/store', { config: { defaultImage: url } }),
    ).then(() => undefined);
  }

  /** Resolve relative /uploads/… URLs so they route through the API proxy. */
  normalizeFile(f: MediaFile): MediaFile {
    return { ...f, preview: f.preview ? this.api.mediaUrl(f.preview) : f.preview };
  }
}
