/**
 * Shared User model — used by both client-web and admin-portal.
 * Import with: import { User, UserRole } from '@shared/models/user.model';
 */

export type UserRole = 'admin' | 'editor' | 'viewer' | 'customer';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** Minimal subset returned in list views */
export type UserSummary = Pick<User, 'id' | 'firstName' | 'lastName' | 'email' | 'role'>;
