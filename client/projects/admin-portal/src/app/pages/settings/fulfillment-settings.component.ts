import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../services/api-client.service';
import { I18nService } from '../../services/i18n.service';
import { ToastService } from '../../services/toast.service';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent } from '../../shared/pill/pill.component';
import { SpinnerComponent } from '../../shared/spinner/spinner.component';

interface Origin {
    address: string;
    city: string;
    state: string;
    countryCode: string;
    zip: string;
    contactName: string;
    phone: string;
    latitude?: number;
    longitude?: number;
}
interface Pickup {
    id: string;
    origin: Origin;
}
interface Config {
    enabled: boolean;
    fallbackId: string | null;
    locations: Pickup[];
    stockLocations: {
        id: string;
        name: string;
    }[];
    perLocation: boolean;
}
@Component({
    selector: 'ap-fulfillment-settings',
    imports: [FormsModule, IconComponent, PillComponent, SpinnerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './fulfillment-settings.component.html',
    styleUrl: './fulfillment-settings.component.scss',
})
export class FulfillmentSettingsComponent implements OnInit {
    private readonly api = inject(ApiClient);
    private readonly i18n = inject(I18nService);
    private readonly toast = inject(ToastService);
    readonly t = this.i18n.t;
    readonly config = signal<Config | null>(null);
    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly error = signal('');
    readonly expanded = new WeakSet<Pickup>();
    readonly fields = ['address', 'city', 'state', 'countryCode', 'zip', 'contactName', 'phone'] as const;
    ngOnInit() { void this.load(); }
    async load() {
        this.loading.set(true);
        this.error.set('');
        try {
            this.config.set(await firstValueFrom(this.api.get<Config>('/admin/inventory/automatic-fulfillment')));
        } catch {
            this.error.set(this.t('fulfillment.loadError'));
        } finally {
            this.loading.set(false);
        }
    }
    add() {
        const location: Pickup = {
            id: '', origin: { address: '', city: 'Doha', state: 'Doha', countryCode: 'QA', zip: '0000', contactName: '', phone: '' },
        };
        this.expanded.add(location);
        this.config()?.locations.push(location);
    }
    locationName(id: string): string {
        return this.config()?.stockLocations.find(location => location.id === id)?.name || this.t('fulfillment.newLocation');
    }
    selectedLocations() {
        const c = this.config();
        return c?.stockLocations.filter(location => c.locations.some(pickup => pickup.id === location.id)) || [];
    }
    remove(index: number) {
        const c = this.config();
        if (!c) return;
        const [removed] = c.locations.splice(index, 1);
        if (removed?.id === c.fallbackId) c.fallbackId = null;
    }
    selectLocation() {
        const c = this.config();
        if (c?.fallbackId && !c.locations.some(location => location.id === c.fallbackId)) c.fallbackId = null;
    }
    async save() {
        const c = this.config();
        if (!c) return;
        this.saving.set(true);
        this.error.set('');
        try {
            await firstValueFrom(this.api.put('/admin/inventory/automatic-fulfillment', {
                enabled: c.enabled, fallbackId: c.fallbackId, locations: c.locations,
            }));
            this.toast.success(this.t('fulfillment.saved'));
        } catch (e: any) {
            this.error.set(e?.error?.message || this.t('fulfillment.loadError'));
        } finally {
            this.saving.set(false);
        }
    }
}
