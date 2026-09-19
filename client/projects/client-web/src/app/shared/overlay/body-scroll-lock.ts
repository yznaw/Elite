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

    document.body.style.overflow = 'hidden';

    if (window.matchMedia(MOBILE_SHEET_QUERY).matches) {
      /*
       * Only safe here, where the body is pinned below. `html, body { height: 100% }` plus
       * the body's `overflow-x: hidden` mean that hiding the root's overflow stops the
       * body's overflow reaching the viewport: the body becomes a 100%-tall scroller of its
       * own, the viewport has nothing left to scroll, and it snaps to the top. On desktop
       * that threw the customer to the top of the collection with the card overlay left
       * behind off-screen. Hiding the body's overflow alone locks the viewport in place.
       */
      document.documentElement.style.overflow = 'hidden';
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

    /*
     * `html { scroll-behavior: smooth }` is set globally, and pinning the body collapses the
     * document so the browser is sitting at the top by the time we unpin. Restoring with a
     * plain scrollTo therefore *animated* the page from the top back down to wherever the
     * customer was, which reads as the page throwing them to the top and crawling back every
     * time they close a size sheet. Restore instantly instead.
     */
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo({ top: this.scrollY, left: 0, behavior: 'instant' as ScrollBehavior });
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
  }
}
