export interface Product {
  id: string;
  name: string;
  sku: string;
  brand: string;
  price: number;
  stock: number;
  has3d: boolean;
  views3d: number;
  hidden: boolean;
  image: string;
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  productIds: string[];
  hidden: boolean;
}

export interface MediaFile {
  id: string;
  name: string;
  kind: 'image' | 'glb';
  size: number;
  w?: number;
  h?: number;
  uploaded: string;
  linkedTo: string | null;
  uploader: string;
  initials: string;
  preview?: string;
}

export interface OrderItem {
  n: string;
  s: number;
  q: number;
  p: number;
}

export interface Order {
  id: string;
  date: string;
  customer: string;
  itemsCount: number;
  total: number;
  payment: 'paid' | 'pending' | 'failed' | 'refunded';
  fulfillment: 'shipped' | 'processing' | 'awaiting' | 'delivered' | 'cancelled' | 'returned';
  items: OrderItem[];
  address: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  orders: number;
  ltv: number;
  sizePref: number;
  lastOrder: string;
  joined: string;
  city: string;
  notes: string;
}

export interface Trigger {
  type: 'manual' | 'auto';
  user?: string;
  initials?: string;
  context?: string;
  label?: string;
}

export interface SyncLog {
  id: string;
  ts: string;
  type: string;
  sourceId: string;
  processed: number;
  updated: number;
  status: 'success' | 'failed' | 'partial' | 'running';
  durationMs: number;
  err: string;
  triggeredBy: Trigger;
}

export interface SyncSource {
  id: string;
  name: string;
  desc: string;
  iconBg: string;
  status: 'success' | 'failed' | 'partial' | 'running';
  schedule: string;
  lastRun: string;
  nextRun: string;
  nextRunIn: string;
  recordsToday: number;
  updatedToday: number;
  avgMs: number;
  successRate: number;
  spark7d: number[];
  last7runs: ('success' | 'partial' | 'failed' | 'pending')[];
  paused: boolean;
  error?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Viewer';
  joined: string;
  initials: string;
}

export interface Integration {
  id: string;
  name: string;
  desc: string;
  connected: boolean;
  meta: string;
}

export interface RevenueDay {
  day: Date;
  rev: number;
  sessions: number;
  conversions: number;
}

export interface TrafficSource {
  source: string;
  pct: number;
  count: number;
  color: string;
}

export interface FunnelStep {
  label: string;
  value: number;
  color: 'green' | 'gold' | 'green';
}

export interface StorefrontBlock {
  id: string;
  type: string;
  title: string;
  visible: boolean;
  config: string;

  /** Type-specific configuration fields. Optional — only fields used by
      the section's type are read; the rest are ignored. */
  subtitle?: string;
  ctaText?: string;
  ctaLink?: string;
  imageUrl?: string;
  productIds?: string[];
  collectionId?: string;
  itemLimit?: number;
  sortBy?: 'newest' | 'bestseller' | 'price-asc' | 'price-desc' | 'manual';
  body?: string;
}

export interface PaletteEntry {
  type: string;
  desc: string;
}

export interface UpcomingRun {
  ts: string;
  label: string;
  in: string;
}

export const QAR = (n: number): string => 'QAR ' + n.toLocaleString();

export const fmtBytes = (n: number): string => {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
};

export const ME = { id: 'T-1', name: 'Yusuf Hamad', initials: 'YH', role: 'Admin' as const };
export const AUTO_TRIGGER: Trigger = { type: 'auto', label: 'Schedule' };
