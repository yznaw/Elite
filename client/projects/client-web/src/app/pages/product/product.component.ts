import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { ProductsService } from '../../services/products.service';
import { Product } from '../../models/product.model';

interface Accordion {
  id: string;
  title: string;
  content: string;
}

@Component({
  selector: 'cw-product',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product.component.html',
  styleUrl: './product.component.scss',
})
export class ProductComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cart = inject(CartService);
  private readonly productsSvc = inject(ProductsService);

  private galleryTimer: number | undefined;
  private feedbackTimer: number | undefined;

  readonly gallery: string[] = [
    'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=900&q=85&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=900&q=85&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1542291026-7b4d3fef59c8?w=900&q=85&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1560343776-97e7d202ff0e?w=900&q=85&auto=format&fit=crop',
  ];

  readonly accordions: Accordion[] = [
    {
      id: 'material',
      title: 'Material & Care',
      content:
        'Crafted from hand-selected full-grain camel leather sourced exclusively from Doha tanneries. The leather is treated with natural oils to achieve its distinctive supple hand. Clean with a soft, dry cloth. Condition monthly with our complimentary leather balm. Store in the included cedar shoe trees.',
    },
    {
      id: 'shipping',
      title: 'Delivery & Packaging',
      content:
        'Complimentary express delivery within Qatar (1–2 business days). International delivery to GCC within 3–5 business days. Each pair is presented in a hand-stamped box with silk tissue and a personalized certificate of authenticity signed by your craftsman.',
    },
    {
      id: 'sizing',
      title: 'Sizing & Fit',
      content:
        'Our shoes are sized in EU measurements and run true to size. If you are between sizes, we recommend sizing up. Bespoke last modifications are available at no additional charge for returning clients. A complimentary sizing kit can be dispatched to your address upon request.',
    },
  ];

  readonly product = signal<Product | null>(null);
  readonly galleryIdx = signal(0);
  readonly selectedSize = signal<number | null>(null);
  readonly openAccordion = signal<string | null>(null);
  readonly addedFeedback = signal(false);
  readonly wishlisted = signal(false);
  readonly qty = signal(1);

  readonly attributes = computed(() => {
    const p = this.product();
    if (!p) return [];
    return [
      { key: 'Leather', value: p.leather },
      { key: 'Style', value: p.style },
      { key: 'Origin', value: 'Doha, Qatar' },
      { key: 'Edition', value: 'Numbered' },
    ];
  });

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    const id = idParam ? Number(idParam) : NaN;
    const p = Number.isFinite(id) ? this.productsSvc.getById(id) : undefined;
    this.product.set(p ?? this.productsSvc.getAll()[0]);

    this.galleryTimer = window.setInterval(() => {
      this.galleryIdx.update((i) => (i + 1) % this.gallery.length);
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.galleryTimer) clearInterval(this.galleryTimer);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
  }

  goCollection(): void {
    void this.router.navigate(['/collection']);
  }

  setGalleryIdx(i: number): void {
    this.galleryIdx.set(i);
  }

  navGallery(dir: number): void {
    this.galleryIdx.update(
      (i) => (i + dir + this.gallery.length) % this.gallery.length,
    );
  }

  selectSize(s: number): void {
    this.selectedSize.set(s);
  }

  decQty(): void { this.qty.update((q) => Math.max(1, q - 1)); }
  incQty(): void { this.qty.update((q) => q + 1); }

  toggleAccordion(id: string): void {
    this.openAccordion.update((cur) => (cur === id ? null : id));
  }

  toggleWishlist(): void {
    this.wishlisted.update((w) => !w);
  }

  add(): void {
    const p = this.product();
    if (!p) return;
    const size = this.selectedSize();
    if (size == null) {
      const el = document.getElementById('size-section');
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    this.cart.add({
      id: p.id,
      name: p.name,
      price: p.price,
      image: p.image,
      leather: p.leather,
      size,
      qty: this.qty(),
    });
    this.addedFeedback.set(true);
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => this.addedFeedback.set(false), 2200);
  }

  speakToAdvisor(): void {
    alert('A client advisor will contact you within 2 hours.');
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }
}
