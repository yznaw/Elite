import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SidebarComponent } from './shared/sidebar/sidebar.component';
import { TopbarComponent } from './shared/topbar/topbar.component';
import { ToastComponent } from './shared/toast/toast.component';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';
import { BottomNavComponent } from './shared/bottom-nav/bottom-nav.component';
import { SidebarToggleService } from './shared/sidebar-toggle.service';

@Component({
  selector: 'ap-root',
  standalone: true,
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
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly router = inject(Router);
  readonly sidebarToggle = inject(SidebarToggleService);

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

  readonly flushTop = computed(() => {
    const u = this.currentUrl();
    return this.flushTopRoutes.some((r) => u.startsWith(r));
  });

  readonly sidebarCollapsed = this.sidebarToggle.collapsed;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.currentUrl.set(e.urlAfterRedirects));
  }
}
