import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LocaleService } from '../../services/locale.service';
import { API_BASE } from '../../core/api-base';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type RestockResult =
  | { kind: 'ok' }
  /** The server says this size and colour are already buyable. The caller decides what to do. */
  | { kind: 'in-stock' }
  | { kind: 'error'; messageKey: string };

export interface RestockInput {
  productId: string;
  /** Null for a one-size product. */
  size: number | null;
  hasSizes: boolean;
  soldOutSizes: number[];
  color: string | null;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Back-in-stock requests, shared by the product page and the collection card.
 *
 * It validates, posts and maps failures to an i18n key, and then returns. Recovery from
 * `IN_STOCK` deliberately stays with the caller: the product page has to put the product,
 * colour, size and quantity back into a buyable state, while the collection card only
 * needs to refresh the catalogue.
 */
@Injectable({ providedIn: 'root' })
export class RestockService {
  private readonly http = inject(HttpClient);
  private readonly locale = inject(LocaleService);
  private readonly apiBase = inject(API_BASE);

  /** Remembered across cards and pages so nobody types their address twice in one visit. */
  readonly lastEmail = signal('');

  async submit(input: RestockInput): Promise<RestockResult> {
    const email = input.email.trim();

    if (input.hasSizes && (input.size === null || !input.soldOutSizes.includes(input.size))) {
      return { kind: 'error', messageKey: 'stock.chooseRestockSize' };
    }
    if (!EMAIL.test(email)) {
      return { kind: 'error', messageKey: 'product.restock.emailError' };
    }

    try {
      await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          `${this.apiBase}/products/${encodeURIComponent(input.productId)}/restock-notifications`,
          {
            email,
            ...(input.hasSizes ? { size: input.size } : {}),
            color: input.color,
            locale: this.locale.locale(),
          },
        ),
      );
      this.lastEmail.set(email);
      return { kind: 'ok' };
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409 && error.error?.code === 'IN_STOCK') {
        return { kind: 'in-stock' };
      }
      return {
        kind: 'error',
        messageKey:
          error instanceof HttpErrorResponse && error.status === 429
            ? 'stock.rateLimit'
            : 'product.restock.submitError',
      };
    }
  }
}
