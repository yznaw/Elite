/**
 * Legal identity of the trading company.
 *
 * These are registry facts, not editorial content, so they are not part of the
 * storefront CMS: nobody should be able to change the commercial registration
 * number from a content editor. Everything a marketer would reasonably want to
 * edit (addresses, hours, phone, email) lives in `contact` content instead.
 *
 * Emitting them on the Organization node is what lets a search engine bind
 * this site to one registered company, rather than to the several unrelated
 * businesses trading under a similar name.
 *
 * Confirmed with Elite on 2026-09-10.
 */
export const BRAND_REGISTRY = {
  legalName: 'Elite Collection Trading',
  /** Qatar commercial registration. */
  crNumber: '115966',
  foundingDate: '2018',
} as const;
