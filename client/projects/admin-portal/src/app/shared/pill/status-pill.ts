import { PillKind } from './pill.component';

export function paymentPillKind(s: string): { kind: PillKind; label: string } {
  switch (s) {
    case 'paid':     return { kind: 'green', label: 'Paid' };
    case 'pending':  return { kind: 'amber', label: 'Pending' };
    case 'failed':   return { kind: 'red',   label: 'Failed' };
    case 'refunded': return { kind: 'grey',  label: 'Refunded' };
    default:         return { kind: 'grey',  label: s };
  }
}

export function fulfillmentPillKind(s: string): { kind: PillKind; label: string } {
  switch (s) {
    case 'shipped':    return { kind: 'blue',  label: 'Shipped' };
    case 'processing': return { kind: 'amber', label: 'Processing' };
    case 'awaiting':   return { kind: 'amber', label: 'Awaiting' };
    case 'delivered':  return { kind: 'green', label: 'Delivered' };
    case 'cancelled':  return { kind: 'red',   label: 'Cancelled' };
    case 'returned':   return { kind: 'grey',  label: 'Returned' };
    default:           return { kind: 'grey',  label: s };
  }
}

export function syncPillKind(s: string): { kind: PillKind; label: string } {
  switch (s) {
    case 'success': return { kind: 'green', label: 'Success' };
    case 'failed':  return { kind: 'red',   label: 'Failed' };
    case 'partial': return { kind: 'amber', label: 'Partial' };
    case 'running': return { kind: 'blue',  label: 'Running' };
    default:        return { kind: 'grey',  label: s };
  }
}
