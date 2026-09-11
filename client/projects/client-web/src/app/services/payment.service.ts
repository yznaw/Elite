import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from '../core/api-base';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface SadadInitiateResponse {
  endpoint: string;
  params: Record<string, string>;
  productDetails: Record<string, string>;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE);

  /**
   * Initiate a Sadad Web Checkout 2.1 payment for the given order.
   *
   * Flow:
   *   1. Call the server to get signed form parameters.
   *   2. Build a hidden HTML form targeting https://sadadqa.com/webpurchase.
   *   3. Submit it — the browser navigates to the Sadad-hosted payment page.
   *   4. After payment, Sadad redirects back to /checkout/success or /checkout/failure.
   *
   * This method does NOT return — the browser navigates away.
   */
  async redirectToSadadCheckout(orderId: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<SadadInitiateResponse>>(
        `${this.apiBase}/payments/sadad/initiate`,
        { orderId },
      ),
    );

    if (!res.success || !res.data) {
      throw new Error(res.message || 'Failed to initiate Sadad payment');
    }

    const { endpoint, params, productDetails } = res.data;

    // Build and submit a hidden form — this is how Sadad Web Checkout works.
    // The form POST causes a full-page redirect to the Sadad payment page.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = endpoint;
    form.name   = 'gosadad';
    form.style.display = 'none';

    // Core signed parameters
    for (const [key, value] of Object.entries(params)) {
      const input = document.createElement('input');
      input.type  = 'hidden';
      input.name  = key;
      input.value = String(value);
      form.appendChild(input);
    }

    // Product detail array fields
    for (const [key, value] of Object.entries(productDetails)) {
      const input = document.createElement('input');
      input.type  = 'hidden';
      input.name  = key;
      input.value = String(value);
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
  }

}
