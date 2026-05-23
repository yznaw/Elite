import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from './api-client.service';

export interface RefColor {
  id: string;
  name_en: string;
  name_ar: string;
  hex: string;
  sort_order: number;
}

export interface RefMaterial {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
}

export interface RefSizeSet {
  id: string;
  name: string;
  sizes: string[];
  sort_order: number;
}

@Injectable({ providedIn: 'root' })
export class AdminRefService {
  private readonly api = inject(ApiClient);

  // ── Colors ────────────────────────────────────────────────────────────────
  getColors(): Promise<RefColor[]> {
    return firstValueFrom(this.api.get<RefColor[]>('/admin/ref/colors'));
  }
  createColor(data: Omit<RefColor, 'id'>): Promise<RefColor> {
    return firstValueFrom(this.api.post<RefColor>('/admin/ref/colors', data));
  }
  updateColor(id: string, data: Partial<Omit<RefColor, 'id'>>): Promise<RefColor> {
    return firstValueFrom(this.api.put<RefColor>(`/admin/ref/colors/${id}`, data));
  }
  deleteColor(id: string): Promise<void> {
    return firstValueFrom(this.api.delete<void>(`/admin/ref/colors/${id}`));
  }

  // ── Materials ─────────────────────────────────────────────────────────────
  getMaterials(): Promise<RefMaterial[]> {
    return firstValueFrom(this.api.get<RefMaterial[]>('/admin/ref/materials'));
  }
  createMaterial(data: Omit<RefMaterial, 'id'>): Promise<RefMaterial> {
    return firstValueFrom(this.api.post<RefMaterial>('/admin/ref/materials', data));
  }
  updateMaterial(id: string, data: Partial<Omit<RefMaterial, 'id'>>): Promise<RefMaterial> {
    return firstValueFrom(this.api.put<RefMaterial>(`/admin/ref/materials/${id}`, data));
  }
  deleteMaterial(id: string): Promise<void> {
    return firstValueFrom(this.api.delete<void>(`/admin/ref/materials/${id}`));
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
}
