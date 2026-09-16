import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BodyScrollLock } from './body-scroll-lock';

export type OverlayVariant =
  /** Rises from the bottom of the screen on phones, centred above that. */
  | 'sheet'
  /** Centred over the whole page. */
  | 'dialog'
  /**
   * Covers the element the caller anchored it to, so it reads as part of that card.
   * Below the sheet breakpoint it becomes a bottom sheet like the others.
   */
  | 'card';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let overlayIdSeq = 0;

/**
 * The one overlay in the storefront.
 *
 * Every dialog here used to be hand-rolled, and each one implemented a different subset
 * of the modal contract: the size sheet claimed `aria-modal` without trapping focus, the
 * size guide did not lock scroll, only the review modal returned focus to its trigger.
 * This owns the chrome and that contract once; callers supply the content.
 *
 * Content is projected. Projected nodes keep their parent's style scope under emulated
 * encapsulation, so this stylesheet cannot reach them, which is exactly why the callers
 * are the two shared wrappers below (`cw-size-sheet`, `cw-restock-form`) rather than the
 * pages: the content markup and its CSS sit together in one place, and the pages only
 * pass data.
 */
@Component({
  selector: 'cw-overlay',
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overlay.component.html',
  styleUrl: './overlay.component.scss',
})
export class OverlayComponent implements OnDestroy {
  private readonly scrollLock = inject(BodyScrollLock);

  @Input() set open(value: boolean) {
    if (value === this._open) return;
    this._open = value;
    value ? this.onOpened() : this.onClosed();
  }
  get open(): boolean {
    return this._open;
  }
  private _open = false;

  @Input() variant: OverlayVariant = 'sheet';
  /** Small caps line above the heading. Optional. */
  @Input() eyebrow = '';
  @Input() heading = '';
  /** Defaults to `heading` when left empty. */
  @Input() ariaLabel = '';
  @Input() closeLabel = 'Close';

  @Output() readonly closed = new EventEmitter<void>();

  /**
   * Setter rather than a plain query so focus moves the moment the panel enters the view.
   * Deferring it to `requestAnimationFrame` would skip it entirely in a hidden tab, where
   * rAF never fires.
   */
  @ViewChild('panel') set panel(ref: ElementRef<HTMLElement> | undefined) {
    this.panelRef = ref;
    if (ref && this._open) this.focusPanel(ref.nativeElement);
  }
  private panelRef?: ElementRef<HTMLElement>;

  readonly headingId = `cw-overlay-heading-${++overlayIdSeq}`;
  readonly rendered = signal(false);

  private trigger?: HTMLElement;
  private locked = false;

  ngOnDestroy(): void {
    // A route change with the overlay open would otherwise leave the body pinned.
    this.onClosed();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this._open) this.close();
  }

  // Angular types `$event` on a pseudo-event binding as `Event`, hence the cast.
  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(rawEvent: Event): void {
    const event = rawEvent as KeyboardEvent;
    if (!this._open) return;
    const panel = this.panelRef?.nativeElement;
    if (!panel) return;

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.offsetParent !== null || element === panel,
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  close(): void {
    this.closed.emit();
  }

  private onOpened(): void {
    this.rendered.set(true);
    if (typeof window === 'undefined') return;

    this.trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    this.scrollLock.acquire();
    this.locked = true;

    // Usually the panel does not exist yet and the ViewChild setter does this instead.
    const panel = this.panelRef?.nativeElement;
    if (panel) this.focusPanel(panel);
  }

  private focusPanel(panel: HTMLElement): void {
    const target = panel.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? panel).focus({ preventScroll: true });
  }

  private onClosed(): void {
    this.rendered.set(false);
    if (typeof window === 'undefined') return;

    if (this.locked) {
      this.scrollLock.release();
      this.locked = false;
    }

    const trigger = this.trigger;
    this.trigger = undefined;
    trigger?.focus({ preventScroll: true });
  }
}
