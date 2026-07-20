import { PillKind } from './pill.component';

/**
 * Status mappers return a translation key (`labelKey`) so callers can render
 * via `i18n.t()`. A plain `label` is also returned for any spot that
 * doesn't have access to the translator.
 */
export interface PillInfo {
  kind: PillKind;
  /** i18n key like `pill.paid` */
  labelKey: string;
  /** English fallback */
  label: string;
}

export function paymentPillKind(s: string): PillInfo {
  switch (s) {
    case 'paid':     return { kind: 'green', labelKey: 'pill.paid',     label: 'Paid' };
    case 'pending':  return { kind: 'amber', labelKey: 'pill.pending',  label: 'Pending' };
    case 'failed':   return { kind: 'red',   labelKey: 'pill.failed',   label: 'Failed' };
    case 'refunded': return { kind: 'grey',  labelKey: 'pill.refunded', label: 'Refunded' };
    default:         return { kind: 'grey',  labelKey: 'pill.' + s,     label: s };
  }
}

export function fulfillmentPillKind(s: string): PillInfo {
  switch (s) {
    case 'shipped':    return { kind: 'blue',  labelKey: 'pill.shipped',    label: 'Shipped' };
    case 'processing': return { kind: 'amber', labelKey: 'pill.processing', label: 'Processing' };
    case 'awaiting':   return { kind: 'amber', labelKey: 'pill.awaiting',   label: 'Awaiting' };
    case 'delivered':  return { kind: 'green', labelKey: 'pill.delivered',  label: 'Delivered' };
    case 'cancelled':  return { kind: 'red',   labelKey: 'pill.cancelled',  label: 'Cancelled' };
    case 'returned':   return { kind: 'grey',  labelKey: 'pill.returned',   label: 'Returned' };
    default:           return { kind: 'grey',  labelKey: 'pill.' + s,       label: s };
  }
}

export function registerStatusPillKind(status: string): PillInfo {
  switch (status) {
    case 'active':   return { kind: 'green', labelKey: 'settings.security.status.active',   label: 'Active' };
    case 'disabled': return { kind: 'grey',  labelKey: 'settings.security.status.disabled', label: 'Disabled' };
    case 'revoked':  return { kind: 'red',   labelKey: 'settings.security.status.revoked',  label: 'Revoked' };
    default:         return { kind: 'grey',  labelKey: 'settings.security.status.' + status, label: status };
  }
}

export function tokenStatusPillKind(status: string): PillInfo {
  switch (status) {
    case 'active':  return { kind: 'green', labelKey: 'settings.security.status.active',  label: 'Active' };
    case 'used':    return { kind: 'blue',  labelKey: 'settings.security.status.used',    label: 'Used' };
    case 'expired': return { kind: 'grey',  labelKey: 'settings.security.status.expired', label: 'Expired' };
    case 'revoked': return { kind: 'red',   labelKey: 'settings.security.status.revoked', label: 'Revoked' };
    default:        return { kind: 'grey',  labelKey: 'settings.security.status.' + status, label: status };
  }
}

/** Role badges: highest-privilege roles read as the "strongest" colors, cashier as a distinct till-only tier. */
export function rolePillKind(role: string): PillInfo {
  switch (String(role || '').toLowerCase()) {
    case 'owner':   return { kind: 'gold',  labelKey: 'settings.role.owner',   label: 'Owner' };
    case 'admin':   return { kind: 'green', labelKey: 'settings.role.admin',   label: 'Admin' };
    case 'manager': return { kind: 'blue',  labelKey: 'settings.role.manager', label: 'Manager' };
    case 'cashier': return { kind: 'amber', labelKey: 'settings.role.cashier', label: 'Cashier' };
    case 'viewer':  return { kind: 'grey',  labelKey: 'settings.role.viewer',  label: 'Viewer' };
    default:        return { kind: 'grey',  labelKey: 'settings.role.' + role, label: role };
  }
}
