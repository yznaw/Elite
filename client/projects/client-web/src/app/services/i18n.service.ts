import { Injectable, inject } from '@angular/core';
import { LocaleService } from './locale.service';
import { STRINGS } from '../i18n/strings';
import { Product } from '../models/product.model';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly locale = inject(LocaleService);

  /** Reactive translator — re-evaluates whenever the locale signal changes. */
  readonly t = (key: string, params?: Record<string, string | number>): string => {
    const dict = STRINGS[this.locale.locale()];
    let value = (dict && dict[key]) ?? key;
    if (params) {
      Object.entries(params).forEach(([param, replacement]) => {
        value = value.replaceAll(`{${param}}`, String(replacement));
      });
    }
    return value;
  };

  readonly price = (value: number, currencyKey = 'common.currency.sar'): string => {
    const locale = this.locale.locale();
    const formatted = value.toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-SA');
    const currency = this.t(currencyKey);
    return locale === 'ar' ? `${formatted} ${currency}` : `${currency} ${formatted}`;
  };

  readonly productName = (product: Pick<Product, 'id' | 'name'>): string =>
    this.t(`productData.${product.id}.name`) !== `productData.${product.id}.name`
      ? this.t(`productData.${product.id}.name`)
      : product.name;

  readonly productLeather = (value: string): string => this.lookup('leather', value);
  readonly productStyle = (value: string): string => this.lookup('style', value);
  readonly productTag = (value: string): string => (value ? this.lookup('tag', value) : '');

  private lookup(group: 'leather' | 'style' | 'tag', value: string): string {
    const key = `productData.${group}.${this.slug(value)}`;
    const translated = this.t(key);
    return translated === key ? value : translated;
  }

  private slug(value: string): string {
    return value
      .replace(/&/g, 'and')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .map((part, index) => index === 0
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  };
}
