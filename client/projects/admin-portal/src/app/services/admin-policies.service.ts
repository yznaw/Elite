import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { Policy, PolicyType } from '../models';

export interface PolicyPayload {
  title?: string;
  handle?: string;
  content?: string;
  policyType?: PolicyType;
  status?: 'active' | 'draft';
  sortOrder?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminPoliciesService {
  private readonly api = inject(ApiClient);

  list(): Promise<Policy[]> {
    return firstValueFrom(this.api.get<Policy[]>('/admin/policies'));
  }

  create(payload: PolicyPayload): Promise<Policy> {
    return firstValueFrom(this.api.post<Policy>('/admin/policies', payload));
  }

  update(id: string, payload: PolicyPayload): Promise<Policy> {
    return firstValueFrom(this.api.patch<Policy>(`/admin/policies/${id}`, payload));
  }

  delete(id: string): Promise<{ id: string }> {
    return firstValueFrom(this.api.delete<{ id: string }>(`/admin/policies/${id}`));
  }
}
