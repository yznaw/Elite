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

export function syncPillKind(s: string): PillInfo {
  switch (s) {
    case 'success': return { kind: 'green', labelKey: 'pill.success', label: 'Success' };
    case 'failed':  return { kind: 'red',   labelKey: 'pill.failed',  label: 'Failed' };
    case 'partial': return { kind: 'amber', labelKey: 'pill.partial', label: 'Partial' };
    case 'running': return { kind: 'blue',  labelKey: 'pill.running', label: 'Running' };
    default:        return { kind: 'grey',  labelKey: 'pill.' + s,    label: s };
  }
}
