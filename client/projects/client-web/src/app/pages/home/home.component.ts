import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { ProductsService } from '../../services/products.service';
import { Product } from '../../models/product.model';

interface MetaCard {
  id: number;
  label: string;
  sub: string;
  icon: string;
}

interface PromiseStat {
  value: string;
  label: string;
}

@Component({
  selector: 'cw-home',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly products = inject(ProductsService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  private metaTimer: number | undefined;

  readonly metaVisible = signal(false);
  readonly featured: Product[] = this.products.getFeatured();

  readonly metaCards: MetaCard[] = [
    { id: 1, label: 'Hand-stitched Detail', sub: 'Triple-lock welt seam', icon: '◊' },
    { id: 2, label: 'Premium Camel Leather', sub: 'Full-grain, Doha tannery', icon: '◆' },
    { id: 3, label: '48hr Crafting Time', sub: 'Single artisan, zero compromise', icon: '◈' },
  ];

  readonly stats: PromiseStat[] = [
    { value: '60+', label: 'Years of Heritage' },
    { value: '12',  label: 'Master Artisans' },
    { value: '48hr', label: 'Per Pair' },
    { value: '∞',   label: 'Lifetime Care' },
  ];

  readonly sketchfabSrc: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    'https://sketchfab.com/models/ef49f910c0734c51964da2da1b8db718/embed?autospin=1&autostart=1&ui_theme=dark&ui_infos=0&ui_controls=1&ui_watermark=0&dnt=1&transparent=1',
  );

  ngOnInit(): void {
    this.metaTimer = window.setTimeout(() => this.metaVisible.set(true), 1800);
  }

  ngOnDestroy(): void {
    if (this.metaTimer) clearTimeout(this.metaTimer);
  }

  goToProduct(p: Product): void {
    void this.router.navigate(['/product', p.id]);
    window.scrollTo(0, 0);
  }

  goTo(path: string): void {
    void this.router.navigate([path]);
    window.scrollTo(0, 0);
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }
}
