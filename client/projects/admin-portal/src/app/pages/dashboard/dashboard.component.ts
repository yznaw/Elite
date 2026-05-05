import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * DashboardComponent — admin-portal home/dashboard page.
 * Replace the template and styles with your actual dashboard content.
 */
@Component({
  selector: 'ap-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!--
      ============================================================
      PLACEHOLDER: Admin Dashboard Page
      ============================================================
      Replace this template with your dashboard HTML.
      You can also use a separate file via:
        templateUrl: './dashboard.component.html'
      ============================================================
    -->
    <main>
      <h1>Admin Dashboard</h1>
      <p>Replace this placeholder with your dashboard content.</p>
    </main>
  `,
  styles: [`
    /* ── Paste your dashboard page styles here ── */
    main {
      padding: 2rem;
    }
  `],
})
export class DashboardComponent {}
