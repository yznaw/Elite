import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { Collection } from '../models';

export interface SaveCollectionPayload {
  title: string;
  description: string;
  imageUrl: string | null;
  productIds: string[];
  hidden: boolean;
  handle?: string;
  parentId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminCollectionsService {
  private readonly api = inject(ApiClient);

  list(): Promise<Collection[]> {
    return firstValueFrom(this.api.get<Collection[]>('/admin/collections'));
  }

  create(payload: SaveCollectionPayload): Promise<Collection> {
    return firstValueFrom(this.api.post<Collection>('/admin/collections', payload));
  }

  update(id: string, payload: Partial<SaveCollectionPayload>): Promise<Collection> {
    return firstValueFrom(this.api.patch<Collection>(`/admin/collections/${id}`, payload));
  }

  archive(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`/admin/collections/${id}`));
  }
}
