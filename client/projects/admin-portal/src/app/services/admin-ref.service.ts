import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';

export interface RefColor {
  id: string;
  name_en: string;
  name_ar: string;
  hex: string;
  swatch_image_url?: string | null;
  sort_order: number;
  variant_count?: number;
}

export interface RefMaterial {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
  variant_count?: number;
}

export interface RefSizeSet {
  id: string;
  name: string;
  sizes: string[];
  sort_order: number;
  usage_hint?: number;
}

@Injectable({ providedIn: 'root' })
export class AdminRefService {
  private readonly api = inject(ApiClient);

  // ── Colors ────────────────────────────────────────────────────────────────
  getColors(): Promise<RefColor[]> {
    return firstValueFrom(this.api.get<RefColor[]>('/admin/ref/colors'));
  }
  createColor(data: Omit<RefColor, 'id' | 'variant_count'>): Promise<RefColor> {
    return firstValueFrom(this.api.post<RefColor>('/admin/ref/colors', data));
  }
  updateColor(id: string, data: Partial<Omit<RefColor, 'id' | 'variant_count'>>): Promise<RefColor> {
    return firstValueFrom(this.api.put<RefColor>(`/admin/ref/colors/${id}`, data));
  }
  /**
   * Delete a color. Pass force=true to bypass the usage guard (clears color_ref_id
   * on affected variants but does NOT delete the variants themselves).
   * Throws with { variantCount } on 409 if used and force is false.
   */
  deleteColor(id: string, force = false): Promise<void> {
    const path = force ? `/admin/ref/colors/${id}?force=true` : `/admin/ref/colors/${id}`;
    return firstValueFrom(this.api.delete<void>(path));
  }
  /** Batch-update sort orders — called after drag-to-reorder. */
  saveColorSortOrders(items: { id: string; sort_order: number }[]): Promise<void> {
    return firstValueFrom(this.api.post<void>('/admin/ref/colors/sort-orders', { items }));
  }

  // ── Materials ─────────────────────────────────────────────────────────────
  getMaterials(): Promise<RefMaterial[]> {
    return firstValueFrom(this.api.get<RefMaterial[]>('/admin/ref/materials'));
  }
  createMaterial(data: Omit<RefMaterial, 'id' | 'variant_count'>): Promise<RefMaterial> {
    return firstValueFrom(this.api.post<RefMaterial>('/admin/ref/materials', data));
  }
  updateMaterial(id: string, data: Partial<Omit<RefMaterial, 'id' | 'variant_count'>>): Promise<RefMaterial> {
    return firstValueFrom(this.api.put<RefMaterial>(`/admin/ref/materials/${id}`, data));
  }
  /**
   * Delete a material. Pass force=true to bypass usage guard (NULLs material
   * on affected variants but does NOT delete the variants).
   */
  deleteMaterial(id: string, force = false): Promise<void> {
    const path = force ? `/admin/ref/materials/${id}?force=true` : `/admin/ref/materials/${id}`;
    return firstValueFrom(this.api.delete<void>(path));
  }
  /** Batch-update sort orders for materials. */
  saveMaterialSortOrders(items: { id: string; sort_order: number }[]): Promise<void> {
    return firstValueFrom(this.api.post<void>('/admin/ref/materials/sort-orders', { items }));
  }

  // ── Size Sets ─────────────────────────────────────────────────────────────
  getSizeSets(): Promise<RefSizeSet[]> {
    return firstValueFrom(this.api.get<RefSizeSet[]>('/admin/ref/size-sets'));
  }
  createSizeSet(data: Omit<RefSizeSet, 'id'>): Promise<RefSizeSet> {
    return firstValueFrom(this.api.post<RefSizeSet>('/admin/ref/size-sets', data));
  }
  updateSizeSet(id: string, data: Partial<Omit<RefSizeSet, 'id'>>): Promise<RefSizeSet> {
    return firstValueFrom(this.api.put<RefSizeSet>(`/admin/ref/size-sets/${id}`, data));
  }
  deleteSizeSet(id: string): Promise<void> {
    return firstValueFrom(this.api.delete<void>(`/admin/ref/size-sets/${id}`));
  }
  duplicateSizeSet(id: string): Promise<RefSizeSet> {
    return firstValueFrom(this.api.post<RefSizeSet>(`/admin/ref/size-sets/${id}/duplicate`, {}));
  }
}
