import { Injectable } from '@angular/core';

/**
 * Below this width an overlay renders as a bottom sheet, and the scroll lock has to
 * pin the body rather than just hide its overflow (iOS Safari ignores `overflow: hidden`
 * on the body). Both the product page and the collection page read this one constant;
 * they used to disagree (759px vs 767px), which left an 8px band where each page
 * thought it was on the other side of the breakpoint.
 */
export const MOBILE_SHEET_MAX = 759;
export const MOBILE_SHEET_QUERY = `(max-width: ${MOBILE_SHEET_MAX}px)`;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Body scroll lock shared by every overlay.
 *
 * Reference counted on purpose: the product page can have the size guide open on top of
 * the size sheet, and with a boolean per component the first one to close would restore
 * scrolling underneath the one still open.
 */
@Injectable({ providedIn: 'root' })
export class BodyScrollLock {
  private depth = 0;
  private scrollY = 0;
  private previousBodyOverflow = '';
  private previousBodyPosition = '';
  private previousBodyTop = '';
  private previousBodyWidth = '';
  private previousHtmlOverflow = '';
  private previousBodyPaddingInlineEnd = '';

  acquire(): void {
    if (typeof window === 'undefined') return;
    if (++this.depth > 1) return;

    this.scrollY = window.scrollY;
    this.previousBodyOverflow = document.body.style.overflow;
    this.previousBodyPosition = document.body.style.position;
    this.previousBodyTop = document.body.style.top;
    this.previousBodyWidth = document.body.style.width;
    this.previousHtmlOverflow = document.documentElement.style.overflow;
    this.previousBodyPaddingInlineEnd = document.body.style.paddingInlineEnd;

    /*
     * Hiding the overflow takes the scrollbar away, and the page reflows into the space it
     * used to occupy. On a grid of cards that reads as every card twitching sideways the
     * moment a dialog opens, so hold the width with padding instead.
     */
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) document.body.style.paddingInlineEnd = `${scrollbar}px`;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    if (window.matchMedia(MOBILE_SHEET_QUERY).matches) {
      document.body.style.position = 'fixed';
      document.body.style.top = `-${this.scrollY}px`;
      document.body.style.width = '100%';
    }
  }

  release(): void {
    if (typeof window === 'undefined') return;
    if (this.depth === 0) return;
    if (--this.depth > 0) return;

    document.body.style.overflow = this.previousBodyOverflow;
    document.body.style.position = this.previousBodyPosition;
    document.body.style.top = this.previousBodyTop;
    document.body.style.width = this.previousBodyWidth;
    document.documentElement.style.overflow = this.previousHtmlOverflow;
    document.body.style.paddingInlineEnd = this.previousBodyPaddingInlineEnd;
    window.scrollTo(0, this.scrollY);
  }
}
