import {
  Product, Collection, MediaFile, Order, Customer, SyncLog, SyncSource,
  TeamMember, Integration, RevenueDay, TrafficSource, FunnelStep,
  StorefrontBlock, PaletteEntry, UpcomingRun, AUTO_TRIGGER,
} from '../models';

export const TODAY = new Date('2026-04-29');

export const PRODUCTS: Product[] = [
  { id: 'P-001', name: 'Al-Mahmal Oxford', sku: 'EC-AMO-2026', brand: 'Elite Atelier', price: 2800, stock: 14, has3d: true, views3d: 842, hidden: false, image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=80&auto=format&fit=crop',
    images: [
      'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1518639192441-8fce0a366e2e?w=600&q=80&auto=format&fit=crop',
    ],
    variants: [
      { id: 'V-001-1', sku: 'EC-AMO-2026-42-BLK', size: '42', color: 'Black',  material: 'Calf Leather',  price: 2800, stock: 4 },
      { id: 'V-001-2', sku: 'EC-AMO-2026-43-BLK', size: '43', color: 'Black',  material: 'Calf Leather',  price: 2800, stock: 5 },
      { id: 'V-001-3', sku: 'EC-AMO-2026-44-BLK', size: '44', color: 'Black',  material: 'Calf Leather',  price: 2800, stock: 3 },
      { id: 'V-001-4', sku: 'EC-AMO-2026-43-BRN', size: '43', color: 'Brown',  material: 'Camel Leather', price: 2950, stock: 2 },
    ] },
  { id: 'P-002', name: 'Najd Derby', sku: 'EC-NDB-2026', brand: 'Elite Atelier', price: 2200, stock: 9, has3d: true, views3d: 621, hidden: false, image: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=600&q=80&auto=format&fit=crop',
    variants: [
      { id: 'V-002-1', sku: 'EC-NDB-2026-41-BLK', size: '41', color: 'Black',  material: 'Calf Leather', price: 2200, stock: 3 },
      { id: 'V-002-2', sku: 'EC-NDB-2026-42-BLK', size: '42', color: 'Black',  material: 'Calf Leather', price: 2200, stock: 4 },
      { id: 'V-002-3', sku: 'EC-NDB-2026-43-BLK', size: '43', color: 'Black',  material: 'Calf Leather', price: 2200, stock: 2 },
    ] },
  { id: 'P-003', name: 'Hijaz Loafer', sku: 'EC-HLF-2026', brand: 'Elite Atelier', price: 1950, stock: 22, has3d: true, views3d: 1104, hidden: false, image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-004', name: 'Rub Al Khali Boot', sku: 'EC-RKB-2026', brand: 'Elite Atelier', price: 3400, stock: 5, has3d: false, views3d: 0, hidden: false, image: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-005', name: 'Medina Mule', sku: 'EC-MML-2026', brand: 'Elite Atelier', price: 1600, stock: 0, has3d: false, views3d: 0, hidden: true, image: 'https://images.unsplash.com/photo-1560343776-97e7d202ff0e?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-006', name: 'Quraish Chelsea', sku: 'EC-QCH-2026', brand: 'Elite Atelier', price: 2650, stock: 11, has3d: true, views3d: 498, hidden: false, image: 'https://images.unsplash.com/photo-1518639192441-8fce0a366e2e?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-007', name: 'Nike Air Max 90', sku: 'NKE-AM90-WHT', brand: 'Nike', price: 680, stock: 42, has3d: true, views3d: 1532, hidden: false, image: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=600&q=80&auto=format&fit=crop',
    images: [
      'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=600&q=80&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=600&q=80&auto=format&fit=crop',
    ] },
  { id: 'P-008', name: 'New Balance 990v6', sku: 'NB-990V6-GRY', brand: 'New Balance', price: 980, stock: 18, has3d: true, views3d: 867, hidden: false, image: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-009', name: 'Adidas Samba OG', sku: 'AD-SMB-BLK', brand: 'Adidas', price: 540, stock: 31, has3d: false, views3d: 0, hidden: false, image: 'https://images.unsplash.com/photo-1518639192441-8fce0a366e2e?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-010', name: 'Common Projects Achilles Low', sku: 'CP-ACH-WHT', brand: 'Common Projects', price: 1740, stock: 7, has3d: true, views3d: 412, hidden: false, image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-011', name: "Dr. Martens 1460", sku: 'DM-1460-CHR', brand: 'Dr. Martens', price: 880, stock: 24, has3d: false, views3d: 0, hidden: false, image: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=600&q=80&auto=format&fit=crop' },
  { id: 'P-012', name: 'ECCO Soft 7', sku: 'EC-S7-NVY', brand: 'ECCO', price: 740, stock: 13, has3d: true, views3d: 284, hidden: false, image: 'https://images.unsplash.com/photo-1560343776-97e7d202ff0e?w=600&q=80&auto=format&fit=crop' },
];

export const COLLECTIONS: Collection[] = [
  { id: 'COL-001', title: 'Summer 2026', description: 'Lightweight leathers and bright accents.', imageUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&q=80', productIds: ['P-003', 'P-005', 'P-012'], hidden: false },
  { id: 'COL-002', title: 'Classic Oxfords', description: 'Timeless elegance for formal occasions.', imageUrl: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600&q=80', productIds: ['P-001'], hidden: false },
  { id: 'COL-003', title: 'Street Style', description: 'Premium sneakers for everyday wear.', imageUrl: 'https://images.unsplash.com/photo-1527090526205-beaac8dc3c62?w=600&q=80', productIds: ['P-007', 'P-008', 'P-009', 'P-010', 'P-012'], hidden: false },
  { id: 'COL-004', title: 'Winter Archive', description: 'Past season styles. Hidden from storefront.', imageUrl: null, productIds: ['P-004', 'P-006', 'P-011'], hidden: true },
];

export const MEDIA_INIT: MediaFile[] = [
  { id: 'M-001', name: 'EC-AMO-2026-front.jpg', kind: 'image', size: 2453621, w: 1600, h: 1600, uploaded: '2026-04-25 14:22', linkedTo: 'P-001', uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-002', name: 'EC-AMO-2026-side.jpg', kind: 'image', size: 1893004, w: 1600, h: 1600, uploaded: '2026-04-25 14:22', linkedTo: 'P-001', uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-003', name: 'EC-AMO-2026.glb', kind: 'glb', size: 4203456, uploaded: '2026-04-12 09:14', linkedTo: 'P-001', uploader: 'Yusuf Hamad', initials: 'YH' },
  { id: 'M-004', name: 'EC-NDB-2026-front.jpg', kind: 'image', size: 2104382, w: 1600, h: 1600, uploaded: '2026-04-22 11:05', linkedTo: 'P-002', uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-005', name: 'EC-NDB-2026.glb', kind: 'glb', size: 3892012, uploaded: '2026-04-13 16:30', linkedTo: 'P-002', uploader: 'Yusuf Hamad', initials: 'YH' },
  { id: 'M-006', name: 'EC-HLF-2026-front.jpg', kind: 'image', size: 2304567, w: 1600, h: 1600, uploaded: '2026-04-23 09:18', linkedTo: 'P-003', uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1600269452121-4f2416e55c28?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-007', name: 'EC-HLF-2026.glb', kind: 'glb', size: 4102345, uploaded: '2026-04-14 10:42', linkedTo: 'P-003', uploader: 'Yusuf Hamad', initials: 'YH' },
  { id: 'M-008', name: 'EC-RKB-2026-front.jpg', kind: 'image', size: 2856710, w: 1600, h: 1600, uploaded: '2026-04-28 16:42', linkedTo: null, uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-009', name: 'EC-RKB-2026-side.jpg', kind: 'image', size: 2104228, w: 1600, h: 1600, uploaded: '2026-04-28 16:43', linkedTo: null, uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-010', name: 'EC-MML-2026.jpg', kind: 'image', size: 1678234, w: 1200, h: 1200, uploaded: '2026-04-28 11:08', linkedTo: null, uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1560343776-97e7d202ff0e?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-011', name: 'AD-SMB-BLK-front.jpg', kind: 'image', size: 1789234, w: 1200, h: 1200, uploaded: '2026-04-28 09:32', linkedTo: null, uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1518639192441-8fce0a366e2e?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-012', name: 'NB-990V6-GRY.glb', kind: 'glb', size: 5421032, uploaded: '2026-04-27 17:12', linkedTo: null, uploader: 'Yusuf Hamad', initials: 'YH' },
  { id: 'M-013', name: 'NKE-AM90-WHT-1.jpg', kind: 'image', size: 1923546, w: 1200, h: 1200, uploaded: '2026-04-20 13:48', linkedTo: 'P-007', uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-014', name: 'NKE-AM90-WHT.glb', kind: 'glb', size: 5621032, uploaded: '2026-04-15 17:22', linkedTo: 'P-007', uploader: 'Yusuf Hamad', initials: 'YH' },
  { id: 'M-015', name: 'CP-ACH-WHT.glb', kind: 'glb', size: 4892145, uploaded: '2026-04-19 11:08', linkedTo: 'P-010', uploader: 'Yusuf Hamad', initials: 'YH' },
  { id: 'M-016', name: 'workshop-hero.jpg', kind: 'image', size: 4203456, w: 2400, h: 1600, uploaded: '2026-04-26 14:20', linkedTo: null, uploader: 'Yusuf Hamad', initials: 'YH', preview: 'https://images.unsplash.com/photo-1582588678413-dbf45f4823e9?w=400&q=80&auto=format&fit=crop' },
  { id: 'M-017', name: 'IMG_2849.jpg', kind: 'image', size: 3128456, w: 3000, h: 2000, uploaded: '2026-04-29 10:14', linkedTo: null, uploader: 'Mona Al-Sayed', initials: 'MS', preview: 'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=400&q=80&auto=format&fit=crop' },
];

export const CUSTOMERS: Customer[] = [
  { id: 'C-001', name: 'Khalid Al-Mansoori', email: 'k.almansoori@gulfmail.qa', orders: 8, ltv: 18400, sizePref: 43, lastOrder: '2026-04-26', joined: '2024-06-12', city: 'Doha', notes: 'Prefers Oxford styles. Bespoke client.' },
  { id: 'C-002', name: 'Fatima Al-Thani', email: 'fatima@althani.qa', orders: 5, ltv: 11200, sizePref: 38, lastOrder: '2026-04-22', joined: '2025-01-08', city: 'Doha', notes: 'Twice-yearly orders. Favors Goat Suede.' },
  { id: 'C-003', name: 'Ahmed Al-Kuwari', email: 'ahmed.k@elitemail.com', orders: 14, ltv: 32600, sizePref: 44, lastOrder: '2026-04-28', joined: '2023-09-04', city: 'Doha', notes: 'VIP. Personal advisor: Yusuf.' },
  { id: 'C-004', name: 'Layla Hassan', email: 'layla.hassan@gmail.com', orders: 3, ltv: 6750, sizePref: 39, lastOrder: '2026-04-19', joined: '2025-09-22', city: 'Lusail', notes: 'New client. Onboarding in progress.' },
  { id: 'C-005', name: 'Omar Al-Sulaiti', email: 'o.alsulaiti@me.com', orders: 11, ltv: 24800, sizePref: 42, lastOrder: '2026-04-25', joined: '2024-03-17', city: 'Al Wakrah', notes: 'Likes limited editions.' },
  { id: 'C-006', name: 'Sarah Johnson', email: 'sarahj@outlook.com', orders: 2, ltv: 4400, sizePref: 37, lastOrder: '2026-04-16', joined: '2025-12-01', city: 'Doha', notes: 'Gift purchases for spouse.' },
  { id: 'C-007', name: 'Michael Chen', email: 'mchen@chenholdings.qa', orders: 6, ltv: 13900, sizePref: 41, lastOrder: '2026-04-24', joined: '2024-11-05', city: 'Doha', notes: 'Corporate gifting account.' },
  { id: 'C-008', name: 'Aisha Al-Mahmoud', email: 'aisha.am@protonmail.com', orders: 9, ltv: 21300, sizePref: 38, lastOrder: '2026-04-27', joined: '2024-02-19', city: 'Al Khor', notes: 'Fashion press contact.' },
  { id: 'C-009', name: 'David Reyes', email: 'd.reyes@reyesgroup.com', orders: 4, ltv: 9650, sizePref: 43, lastOrder: '2026-04-12', joined: '2025-05-10', city: 'Doha', notes: 'Expat. Ships to Doha office.' },
  { id: 'C-010', name: 'Noor Al-Attiyah', email: 'noor.attiyah@gulfnet.qa', orders: 7, ltv: 16200, sizePref: 39, lastOrder: '2026-04-20', joined: '2024-08-30', city: 'Doha', notes: 'Bridal gift commissions.' },
];

export const ORDERS: Order[] = [
  { id: 'EC-26-1042', date: '2026-04-28', customer: 'Ahmed Al-Kuwari', itemsCount: 2, total: 5200, payment: 'paid', fulfillment: 'shipped', items: [{ n: 'Al-Mahmal Oxford', s: 44, q: 1, p: 2800 }, { n: 'Hijaz Loafer', s: 43, q: 1, p: 2400 }], address: 'Villa 14, Al-Dafna, Doha' },
  { id: 'EC-26-1041', date: '2026-04-28', customer: 'Aisha Al-Mahmoud', itemsCount: 1, total: 2200, payment: 'paid', fulfillment: 'processing', items: [{ n: 'Najd Derby', s: 38, q: 1, p: 2200 }], address: 'Tower B 1208, The Pearl, Doha' },
  { id: 'EC-26-1040', date: '2026-04-27', customer: 'Khalid Al-Mansoori', itemsCount: 3, total: 7150, payment: 'paid', fulfillment: 'shipped', items: [{ n: 'Rub Al Khali Boot', s: 43, q: 1, p: 3400 }, { n: 'Hijaz Loafer', s: 43, q: 2, p: 1875 }], address: 'Villa 27, West Bay, Doha' },
  { id: 'EC-26-1039', date: '2026-04-26', customer: 'Omar Al-Sulaiti', itemsCount: 1, total: 2650, payment: 'paid', fulfillment: 'delivered', items: [{ n: 'Quraish Chelsea', s: 42, q: 1, p: 2650 }], address: 'Apartment 402, Al Wakrah Marina' },
  { id: 'EC-26-1038', date: '2026-04-26', customer: 'Layla Hassan', itemsCount: 1, total: 1950, payment: 'pending', fulfillment: 'awaiting', items: [{ n: 'Hijaz Loafer', s: 39, q: 1, p: 1950 }], address: 'Lusail Boulevard 18, Lusail' },
  { id: 'EC-26-1037', date: '2026-04-25', customer: 'Noor Al-Attiyah', itemsCount: 2, total: 5450, payment: 'paid', fulfillment: 'delivered', items: [{ n: 'Najd Derby', s: 39, q: 1, p: 2200 }, { n: 'Quraish Chelsea', s: 39, q: 1, p: 3250 }], address: 'Villa 9, Onaiza, Doha' },
  { id: 'EC-26-1036', date: '2026-04-25', customer: 'Michael Chen', itemsCount: 4, total: 11200, payment: 'paid', fulfillment: 'shipped', items: [{ n: 'Al-Mahmal Oxford', s: 41, q: 2, p: 2800 }, { n: 'Najd Derby', s: 41, q: 2, p: 2800 }], address: 'Suite 21, City Tower, Doha' },
  { id: 'EC-26-1035', date: '2026-04-24', customer: 'Fatima Al-Thani', itemsCount: 1, total: 2200, payment: 'refunded', fulfillment: 'returned', items: [{ n: 'Najd Derby', s: 38, q: 1, p: 2200 }], address: 'Villa 5, Al-Dafna, Doha' },
  { id: 'EC-26-1034', date: '2026-04-23', customer: 'David Reyes', itemsCount: 1, total: 1600, payment: 'paid', fulfillment: 'delivered', items: [{ n: 'Medina Mule', s: 43, q: 1, p: 1600 }], address: 'Compound 8, Al Sadd, Doha' },
  { id: 'EC-26-1033', date: '2026-04-22', customer: 'Sarah Johnson', itemsCount: 1, total: 2200, payment: 'failed', fulfillment: 'cancelled', items: [{ n: 'Najd Derby', s: 37, q: 1, p: 2200 }], address: 'Westbay Suites 1402, Doha' },
  { id: 'EC-26-1032', date: '2026-04-21', customer: 'Ahmed Al-Kuwari', itemsCount: 1, total: 3400, payment: 'paid', fulfillment: 'delivered', items: [{ n: 'Rub Al Khali Boot', s: 44, q: 1, p: 3400 }], address: 'Villa 14, Al-Dafna, Doha' },
  { id: 'EC-26-1031', date: '2026-04-20', customer: 'Aisha Al-Mahmoud', itemsCount: 2, total: 4400, payment: 'paid', fulfillment: 'delivered', items: [{ n: 'Hijaz Loafer', s: 38, q: 1, p: 1950 }, { n: 'Quraish Chelsea', s: 38, q: 1, p: 2450 }], address: 'Tower B 1208, The Pearl, Doha' },
];

export const SYNC_LOGS: SyncLog[] = [
  { id: 'L-119', ts: '2026-04-29 09:42:18', type: 'Product Sync', sourceId: 'csv', processed: 1, updated: 1, status: 'success', durationMs: 920, err: '', triggeredBy: { type: 'manual', user: 'Mona Al-Sayed', initials: 'MS', context: 'Product · P-004 Rub Al Khali Boot' } },
  { id: 'L-118', ts: '2026-04-29 06:00:14', type: 'CSV Sync', sourceId: 'csv', processed: 1240, updated: 38, status: 'success', durationMs: 4180, err: '', triggeredBy: AUTO_TRIGGER },
  { id: 'L-117', ts: '2026-04-29 02:14:55', type: 'CSV Sync', sourceId: 'csv', processed: 1239, updated: 0, status: 'success', durationMs: 3820, err: '', triggeredBy: { type: 'manual', user: 'Yusuf Hamad', initials: 'YH', context: 'Manual full sync · pre-launch QA' } },
  { id: 'L-116', ts: '2026-04-28 18:00:21', type: 'CSV Sync', sourceId: 'csv', processed: 1238, updated: 14, status: 'success', durationMs: 3960, err: '', triggeredBy: AUTO_TRIGGER },
  { id: 'L-114', ts: '2026-04-28 06:00:09', type: 'CSV Sync', sourceId: 'csv', processed: 1235, updated: 22, status: 'success', durationMs: 4310, err: '', triggeredBy: AUTO_TRIGGER },
  { id: 'L-113', ts: '2026-04-27 21:08:33', type: 'CSV Sync', sourceId: 'csv', processed: 1232, updated: 11, status: 'success', durationMs: 4720, err: '', triggeredBy: { type: 'manual', user: 'Yusuf Hamad', initials: 'YH', context: 'Manual retry of L-112' } },
  { id: 'L-112', ts: '2026-04-27 18:00:42', type: 'CSV Sync', sourceId: 'csv', processed: 1232, updated: 11, status: 'partial', durationMs: 5240, err: '2 SKUs failed validation: missing barcode (P-098, P-104).', triggeredBy: AUTO_TRIGGER },
  { id: 'L-111', ts: '2026-04-27 06:00:18', type: 'CSV Sync', sourceId: 'csv', processed: 1230, updated: 7, status: 'success', durationMs: 4080, err: '', triggeredBy: AUTO_TRIGGER },
  { id: 'L-109', ts: '2026-04-26 18:00:13', type: 'CSV Sync', sourceId: 'csv', processed: 1229, updated: 18, status: 'success', durationMs: 4220, err: '', triggeredBy: AUTO_TRIGGER },
  { id: 'L-108', ts: '2026-04-26 06:00:07', type: 'CSV Sync', sourceId: 'csv', processed: 1227, updated: 31, status: 'success', durationMs: 4490, err: '', triggeredBy: AUTO_TRIGGER },
  { id: 'L-107', ts: '2026-04-25 18:00:11', type: 'CSV Sync', sourceId: 'csv', processed: 1224, updated: 9, status: 'success', durationMs: 4070, err: '', triggeredBy: AUTO_TRIGGER },
];

export const SYNC_SOURCES: SyncSource[] = [
  {
    id: 'csv',
    name: 'Counterpoint POS',
    desc: 'Inventory pull from in-store POS · CSV feed',
    iconBg: 'csv',
    status: 'success',
    schedule: 'Every 12 hours',
    lastRun: '2026-04-29 06:00',
    nextRun: '2026-04-29 18:00',
    nextRunIn: 'in 5h 47m',
    recordsToday: 1240,
    updatedToday: 38,
    avgMs: 4180,
    successRate: 99.2,
    spark7d: [99, 100, 98, 100, 100, 99, 99],
    last7runs: ['success', 'success', 'success', 'success', 'partial', 'success', 'success'],
    paused: false,
  },
];

export const UPCOMING_RUNS: UpcomingRun[] = [
  { ts: '2026-04-29 18:00', label: 'Today, 18:00', in: 'in 5h 47m' },
  { ts: '2026-04-30 06:00', label: 'Tomorrow, 06:00', in: 'in 17h 47m' },
  { ts: '2026-04-30 18:00', label: 'Tomorrow, 18:00', in: 'in 29h 47m' },
  { ts: '2026-05-01 06:00', label: 'May 1, 06:00', in: 'in 41h 47m' },
  { ts: '2026-05-01 18:00', label: 'May 1, 18:00', in: 'in 53h 47m' },
];

export const REVENUE_30D: RevenueDay[] = (() => {
  const seed = [3200, 4100, 2900, 5400, 4800, 7200, 6100, 4500, 3800, 5200, 6800, 7500, 5900, 4300, 5100, 6600, 8200, 7100, 5400, 6300, 7800, 9100, 6800, 5500, 7200, 8400, 9600, 7300, 8100, 9800];
  return seed.map((v, i) => ({
    day: new Date(TODAY.getTime() - (29 - i) * 86400000),
    rev: v,
    sessions: Math.round(v * 0.42 + 1100 + Math.sin(i / 3) * 200),
    conversions: Math.round(v * 0.012 + 6),
  }));
})();

export const TRAFFIC: TrafficSource[] = [
  { source: 'Direct', pct: 38, count: 11240, color: '#0f2356' },
  { source: 'Instagram', pct: 31, count: 9180, color: '#c5a572' },
  { source: 'Google', pct: 22, count: 6510, color: '#3b82f6' },
  { source: 'Other', pct: 9, count: 2660, color: '#94a3b8' },
];

export const FUNNEL: FunnelStep[] = [
  { label: 'Visits', value: 29590, color: 'green' },
  { label: 'Product View', value: 18420, color: 'green' },
  { label: 'Add to Cart', value: 6280, color: 'gold' },
  { label: 'Checkout', value: 2140, color: 'gold' },
  { label: 'Purchase', value: 1580, color: 'green' },
];

export const TEAM: TeamMember[] = [
  { id: 'T-1', name: 'Yusuf Hamad', email: 'yusuf@elitecollection.qa', role: 'Admin', joined: '2023-06-01', initials: 'YH' },
  { id: 'T-2', name: 'Mona Al-Sayed', email: 'mona@elitecollection.qa', role: 'Manager', joined: '2024-02-14', initials: 'MS' },
  { id: 'T-3', name: 'Hassan Karim', email: 'hassan@elitecollection.qa', role: 'Manager', joined: '2024-09-08', initials: 'HK' },
  { id: 'T-4', name: 'Lina Bassam', email: 'lina@elitecollection.qa', role: 'Viewer', joined: '2025-03-22', initials: 'LB' },
];

export const INTEGRATIONS: Integration[] = [
  { id: 'cp', name: 'Counterpoint POS CSV', desc: 'Hourly inventory pull from in-store POS.', connected: true, meta: 'Configured · /api/cp.csv · every 12h' },
  { id: 'google', name: 'Google Shopping', desc: 'Push catalog feed to Google Merchant.', connected: true, meta: 'Connected · 412 SKUs live' },
  { id: 'mailer', name: 'Mailgun · Transactional', desc: 'Order confirmations & shipping emails.', connected: true, meta: 'Connected · 286 emails sent today' },
];

export const STOREFRONT_DEFAULT: StorefrontBlock[] = [
  { id: 'b1', type: 'Hero Banner', title: 'Spring Heritage 2026', visible: true, config: 'Loafer Hero · Sketchfab' },
  { id: 'b2', type: 'Featured Products', title: 'Icons of Craft', visible: true, config: '3 picks · Auto-rotate' },
  { id: 'b3', type: 'Brand Story', title: 'Six Decades of Silence', visible: true, config: 'Cinematic 4-chapter scroll' },
  { id: 'b4', type: 'New Arrivals', title: 'Fresh from the Atelier', visible: true, config: '12 newest · Last 30 days' },
  { id: 'b5', type: 'Sale Items', title: 'Limited Pieces', visible: false, config: 'Hidden — clearance off-season' },
];

export const PALETTE: PaletteEntry[] = [
  { type: 'Hero Banner', desc: 'Full-bleed kicker with 3D model' },
  { type: 'Featured Products', desc: 'Curated 3-up grid' },
  { type: 'New Arrivals', desc: 'Auto-pulls latest SKUs' },
  { type: 'Sale Items', desc: 'Discount-tagged products' },
  { type: 'Brand Story', desc: 'Editorial chapter scroll' },
];

const SKU_RE = /^([A-Z]{2,3}-[A-Z0-9]{2,5}-[A-Z0-9]{2,6})/i;

export function extractSkuFromName(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.match(SKU_RE);
  return m ? m[1].toUpperCase() : null;
}

export function findProductBySkuPrefix(sku: string | null): Product | undefined {
  if (!sku) return undefined;
  return PRODUCTS.find((p) => p.sku.toUpperCase() === sku);
}

export interface Suggestion {
  product: Product;
  conf: 'high' | 'medium' | 'low';
  why: string;
}

export function suggestProduct(media: MediaFile): Suggestion | null {
  const sku = extractSkuFromName(media.name);
  const exact = findProductBySkuPrefix(sku);
  if (exact && sku) return { product: exact, conf: 'high', why: `SKU prefix "${sku}" matches exactly` };
  const upper = media.name.toUpperCase();
  for (const p of PRODUCTS) {
    if (upper.includes(p.sku.toUpperCase())) {
      return { product: p, conf: 'medium', why: `Filename contains SKU "${p.sku}"` };
    }
  }
  const words = media.name.toLowerCase().replace(/\.[^.]+$/, '').split(/[-_\s]+/);
  for (const p of PRODUCTS) {
    const tokens = p.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 4);
    const found = tokens.find((t) => words.some((w) => w.includes(t)));
    if (found) return { product: p, conf: 'low', why: `Filename contains "${found}"` };
  }
  return null;
}
