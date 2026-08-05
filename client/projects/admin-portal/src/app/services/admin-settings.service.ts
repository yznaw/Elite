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

  sendInvitation(payload: { email: string; role: string }): Promise<{ email: string; inviteLink: string; emailSent: boolean; hadPendingInvite: boolean }> {
    return firstValueFrom(this.api.post<{ email: string; inviteLink: string; emailSent: boolean; hadPendingInvite: boolean }>('/admin/settings/invitations', payload));
  }

  resendInvitation(id: string): Promise<{ email: string; inviteLink: string; emailSent: boolean }> {
    return firstValueFrom(this.api.post<{ email: string; inviteLink: string; emailSent: boolean }>(`/admin/settings/invitations/${id}/resend`, {}));
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

  /** `branchId: null` unassigns the register — it falls back to the tenant's default branch. */
  setRegisterBranch(registerId: string, branchId: string | null): Promise<{ registerId: string; branchId: string | null }> {
    return firstValueFrom(this.api.put<{ registerId: string; branchId: string | null }>(`/admin/pos-security/registers/${registerId}/branch`, { branchId }));
  }

  listBranches(): Promise<PosBranchRow[]> {
    return firstValueFrom(this.api.get<PosBranchRow[]>('/admin/pos-branches'));
  }

  createBranch(payload: PosBranchInput): Promise<PosBranchRow> {
    return firstValueFrom(this.api.post<PosBranchRow>('/admin/pos-branches', payload));
  }

  updateBranch(branchId: string, payload: PosBranchInput): Promise<PosBranchRow> {
    return firstValueFrom(this.api.patch<PosBranchRow>(`/admin/pos-branches/${branchId}`, payload));
  }

  deleteBranch(branchId: string): Promise<{ branchId: string; deleted: boolean }> {
    return firstValueFrom(this.api.delete<{ branchId: string; deleted: boolean }>(`/admin/pos-branches/${branchId}`));
  }

  setDefaultBranch(branchId: string): Promise<{ branchId: string; isDefault: boolean }> {
    return firstValueFrom(this.api.post<{ branchId: string; isDefault: boolean }>(`/admin/pos-branches/${branchId}/set-default`, {}));
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
  /** null = not explicitly assigned; the register still prints the tenant's default branch. */
  branchId: string | null;
  branchName: string | null;
}

/** A physical shop location: its own printable receipt identity. */
export interface PosBranchRow {
  id: string;
  /** Internal label only (e.g. "The Pearl") — never printed. */
  name: string;
  tradeNameAr: string;
  tradeNameEn: string;
  addressAr: string;
  addressEn: string;
  phone: string;
  crLicenseNumber: string | null;
  returnPolicyAr: string | null;
  returnPolicyEn: string | null;
  isDefault: boolean;
  updatedAt: string;
}

export type PosBranchInput = Omit<PosBranchRow, 'id' | 'isDefault' | 'updatedAt'>;

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
  last_sent_at: string;
  email_sent: boolean;
  resend_count: number;
  invited_by_name?: string;
}
