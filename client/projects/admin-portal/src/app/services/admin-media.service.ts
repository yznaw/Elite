import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { MediaFile } from '../models';

@Injectable({ providedIn: 'root' })
export class AdminMediaService {
  private readonly api = inject(ApiClient);

  list(): Promise<MediaFile[]> {
    return firstValueFrom(this.api.get<MediaFile[]>('/admin/media'));
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
}
