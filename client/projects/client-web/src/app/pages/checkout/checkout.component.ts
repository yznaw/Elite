import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CartService } from '../../services/cart.service';

const STEPS = ['Details', 'Delivery', 'Payment'] as const;

interface CheckoutForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  cardNum: string;
  expiry: string;
  cvv: string;
  name: string;
}

@Component({
  selector: 'cw-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.scss',
})
export class CheckoutComponent {
  readonly cart = inject(CartService);
  private readonly router = inject(Router);

  readonly steps = STEPS;
  readonly countries = ['Qatar', 'UAE', 'Kuwait', 'Saudi Arabia', 'Bahrain', 'Oman'];

  readonly step = signal(0);
  readonly placed = signal(false);

  readonly form = signal<CheckoutForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: 'Qatar',
    cardNum: '',
    expiry: '',
    cvv: '',
    name: '',
  });

  readonly subtotal = computed(() => this.cart.subtotal());
  readonly total = computed(() => this.subtotal());

  set<K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  next(): void {
    if (this.step() < STEPS.length - 1) {
      this.step.update((s) => s + 1);
    } else {
      this.placed.set(true);
      this.cart.clear();
    }
  }

  back(): void {
    this.step.update((s) => Math.max(0, s - 1));
  }

  jumpTo(i: number): void {
    if (i < this.step()) this.step.set(i);
  }

  goCollection(): void {
    void this.router.navigate(['/collection']);
    window.scrollTo(0, 0);
  }

  onImgError(e: Event): void {
    (e.target as HTMLImageElement).style.display = 'none';
  }
}
