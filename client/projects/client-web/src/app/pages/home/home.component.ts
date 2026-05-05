import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * HomeComponent — client-web landing page.
 * Replace the template and styles with your actual home page content.
 */
@Component({
  selector: 'cw-home',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!--
      ============================================================
      PLACEHOLDER: Home Page
      ============================================================
      Replace this template with your home page HTML.
      You can also convert to a separate .html file by setting:
        templateUrl: './home.component.html'
      ============================================================
    -->
    <main>
      <h1>Welcome to Elite</h1>
      <p>Replace this placeholder with your home page content.</p>
    </main>
  `,
  styles: [`
    /* ── Paste your home page styles here ── */
    main {
      padding: 2rem;
    }
  `],
})
export class HomeComponent {}
