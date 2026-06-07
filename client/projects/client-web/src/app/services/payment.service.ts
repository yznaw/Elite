import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface SadadSession {
  redirectUrl: string;
  sessionId: string;
}

export interface SadadPaymentStatus {
  sessionId: string;
  paymentStatus: 'paid' | 'pending' | 'failed';
  raw: unknown;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = this.resolveApiBase();

  /**
   * Create a Sadad payment session for an existing order.
   * On success, redirect the user to the returned redirectUrl.
   */
  initiateSadadPayment(orderId: string): Promise<SadadSession> {
    return firstValueFrom(
      this.http.post<ApiResponse<SadadSession>>(`${this.apiBase}/payments/sadad/initiate`, { orderId }),
    ).then((res) => res.data);
  }

  /**
   * Check the payment status after the customer returns from Sadad.
   * Call this on the /checkout/success page using the sessionId query param.
   */
  getSadadPaymentStatus(sessionId: string): Promise<SadadPaymentStatus> {
    return firstValueFrom(
      this.http.get<ApiResponse<SadadPaymentStatus>>(`${this.apiBase}/payments/sadad/status/${sessionId}`),
    ).then((res) => res.data);
  }

  private resolveApiBase(): string {
    const { hostname, protocol } = window.location;
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    return isLocal ? `${protocol}//${hostname}:3000/api` : '/api';
  }
}
