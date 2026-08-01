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

  listRegisters(): Promise<PosRegisterRow[]> {
    return firstValueFrom(this.api.get<PosRegisterRow[]>('/admin/pos-security/registers'));
  }

  revokeRegister(registerId: string): Promise<{ registerId: string; status: string }> {
    return firstValueFrom(this.api.post<{ registerId: string; status: string }>(`/admin/pos-security/registers/${registerId}/revoke`, {}));
  }

  listEnrollmentTokens(): Promise<PosEnrollmentTokenRow[]> {
    return firstValueFrom(this.api.get<PosEnrollmentTokenRow[]>('/admin/pos-security/enrollment-tokens'));
  }

  revokeEnrollmentToken(tokenId: string): Promise<{ tokenId: string; status: string }> {
    return firstValueFrom(this.api.post<{ tokenId: string; status: string }>(`/admin/pos-security/enrollment-tokens/${tokenId}/revoke`, {}));
  }

  listManagerPins(): Promise<ManagerPinRow[]> {
    return firstValueFrom(this.api.get<ManagerPinRow[]>('/admin/pos-security/manager-pins'));
  }

  clearManagerPin(userId: string): Promise<{ managerId: string; configured: boolean }> {
    return firstValueFrom(this.api.post<{ managerId: string; configured: boolean }>(`/admin/pos-security/manager-pins/${userId}/clear`, {}));
  }

  getPosPolicy(): Promise<PosPolicy> {
    return firstValueFrom(this.api.get<PosPolicy>('/admin/pos-security/policy'));
  }

  updatePosPolicy(input: { selfCloseShiftEnabled?: boolean; emergencySelfApprovalEnabled?: boolean }): Promise<PosPolicy> {
    return firstValueFrom(this.api.put<PosPolicy>('/admin/pos-security/policy', input));
  }
}

export interface PosPolicy {
  selfCloseShiftEnabled: boolean;
  emergencySelfApprovalEnabled: boolean;
}

export interface PosRegisterRow {
  registerId: string;
  displayName: string;
  status: 'active' | 'disabled' | 'revoked';
  lastSeenAt: string | null;
  createdAt: string;
}

export interface PosEnrollmentTokenRow {
  tokenId: string;
  displayName: string;
  createdByName: string | null;
  expiresAt: string;
  createdAt: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
}

export interface ManagerPinRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  configured: boolean;
  lastUpdatedAt: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
  invited_by_name?: string;
}
