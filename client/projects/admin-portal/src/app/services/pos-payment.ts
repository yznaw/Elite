/** Tenders the till accepts. The server (sale-service.js) is the authority;
    this union only keeps the client in step with it. Kept free of Angular so
    exporters and tests can use it without the HTTP stack. */
export type PosPaymentMethod = 'cash' | 'card' | 'sadad';

export const POS_PAYMENT_LABELS: Record<PosPaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  sadad: 'Sadad',
};

/** Same shape the server enforces for a Sadad transaction ID (after trim and
    uppercase). Used only to guide the cashier before submitting. */
export const SADAD_REFERENCE_PATTERN = /^[A-Z0-9-]{4,40}$/;
