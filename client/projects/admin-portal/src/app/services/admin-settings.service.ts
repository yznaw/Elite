import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';
import { TeamMember } from '../models';

export interface StoreSettingsPayload {
  name?: string;
  storeName?: string;
  currency?: string;
  timezone?: string;
  language?: string;
}

export interface StoreSettingsResponse {
  name: string;
  slug?: string;
  currency: string;
  timezone: string;
  store_name?: string;
  language?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminSettingsService {
  private readonly api = inject(ApiClient);

  getStore(): Promise<StoreSettingsResponse> {
    return firstValueFrom(this.api.get<StoreSettingsResponse>('/admin/settings/store'));
  }

  patchStore(payload: StoreSettingsPayload): Promise<void> {
    return firstValueFrom(
      this.api.patch<unknown>('/admin/settings/store', payload),
    ).then(() => undefined);
  }

  getTeam(): Promise<TeamMember[]> {
    return firstValueFrom(this.api.get<TeamMember[]>('/admin/settings/team'));
  }

  inviteTeam(payload: { name: string; email: string; role: string }): Promise<TeamMember> {
    return firstValueFrom(this.api.post<TeamMember>('/admin/settings/team', payload));
  }

  patchTeam(id: string, payload: { name?: string; email?: string; role?: string; status?: string }): Promise<TeamMember> {
    return firstValueFrom(this.api.patch<TeamMember>(`/admin/settings/team/${id}`, payload));
  }

  getInvitations(): Promise<Invitation[]> {
    return firstValueFrom(this.api.get<Invitation[]>('/admin/settings/invitations'));
  }

  sendInvitation(payload: { email: string; role: string }): Promise<{ email: string; inviteLink: string }> {
    return firstValueFrom(this.api.post<{ email: string; inviteLink: string }>('/admin/settings/invitations', payload));
  }

  revokeInvitation(id: string): Promise<void> {
    return firstValueFrom(this.api.delete<unknown>(`/admin/settings/invitations/${id}`)).then(() => undefined);
  }
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
  invited_by_name?: string;
}
