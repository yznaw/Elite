import { Component, HostListener, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SidebarComponent } from './shared/sidebar/sidebar.component';
import { TopbarComponent } from './shared/topbar/topbar.component';
import { ToastComponent } from './shared/toast/toast.component';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';
import { BottomNavComponent } from './shared/bottom-nav/bottom-nav.component';
import { SidebarToggleService } from './shared/sidebar-toggle.service';
import { AuthService } from './services/auth.service';
import { ToastService } from './services/toast.service';
import { I18nService } from './services/i18n.service';
import { sendToLoginAfterSessionExpiry } from './interceptors/http-error.interceptor';
import { consumeUpdatedNotice } from './services/stale-build';

/** How long a tab must sit in the background before its session is rechecked. */
const RESUME_CHECK_AFTER_MS = 5 * 60 * 1000;

@Component({
    selector: 'ap-root',
    imports: [
        CommonModule,
        RouterOutlet,
        SidebarComponent,
        TopbarComponent,
        ToastComponent,
        ConfirmDialogComponent,
        BottomNavComponent,
    ],
    templateUrl: './app.component.html',
    changeDetection: ChangeDetectionStrategy.Eager,
    styleUrl: './app.component.scss'
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  readonly sidebarToggle = inject(SidebarToggleService);
  private hiddenAt: number | null = null;

  private readonly currentUrl = signal<string>(this.router.url);
  private readonly shelllessRoutes = ['/login', '/forgot-password', '/reset-password', '/pos'];
  /** Pages that have their own full-width sticky sub-toolbar need the
      scroll-area top padding removed so the sub-toolbar clips flush
      against the topbar with no visible gap. */
  private readonly flushTopRoutes = ['/storefront'];

  readonly showShell = computed(() => {
    const u = this.currentUrl();
    return !this.shelllessRoutes.some((r) => u.startsWith(r));
  });

  // The POS cart panel is a fixed 390px column pinned to the viewport's
  // right edge, with "Take payment" flush at its bottom — exactly where
  // <ap-toast> anchors by default. See styles.scss for the offset this
  // drives.
  readonly isPosRoute = computed(() => this.currentUrl().startsWith('/pos'));

  readonly flushTop = computed(() => {
    const u = this.currentUrl();
    return this.flushTopRoutes.some((r) => u.startsWith(r));
  });

  readonly sidebarCollapsed = this.sidebarToggle.collapsed;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));

    if (consumeUpdatedNotice()) {
      this.toast.info(this.i18n.t('app.updated.title'), this.i18n.t('app.updated.sub'));
    }
  }

  /**
   * A tab left in the background for hours can outlive its 12h idle session
   * while still showing the signed-in shell. Recheck on return so the operator
   * is told and sent to sign in straight away, instead of finding out through
   * a click that fails. The POS and the auth pages are shell-less and skipped.
   */
  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
      return;
    }
    const hiddenFor = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (hiddenFor < RESUME_CHECK_AFTER_MS || !this.showShell()) return;
    // me() returns null only when the server rejects the session (the shell
    // always has a cached user to fall back on during a network drop).
    void this.auth.me().then((user) => {
      if (!user) sendToLoginAfterSessionExpiry(this.router, this.toast, this.i18n);
    });
  }
}
