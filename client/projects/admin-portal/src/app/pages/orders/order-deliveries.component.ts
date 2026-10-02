import { Component, Input, Output, EventEmitter, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../services/api-client.service';
import { I18nService } from '../../services/i18n.service';
import { AuthService } from '../../services/auth.service';
import { DecimalPipe } from '@angular/common';
import { IconComponent } from '../../shared/icons/icon.component';
import { PillComponent, PillKind } from '../../shared/pill/pill.component';
import { Order } from '../../models';
@Component({
    selector: 'ap-order-deliveries',
    imports: [FormsModule, IconComponent, PillComponent, DecimalPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './order-deliveries.component.html',
    styleUrl: './order-deliveries.component.scss',
})
export class OrderDeliveriesComponent {
    @Input({ required: true })
    order!: Order;
    @Output()
    updated = new EventEmitter<Order>();
    private readonly api = inject(ApiClient);
    private readonly auth = inject(AuthService);
    readonly t = inject(I18nService).t;
    readonly busy = signal(false);
    readonly error = signal('');
    private readonly forms = new Map<string, {
        note: string;
        providerId: string;
        confirmed: boolean;
    }>();
    form(id: string) {
        if (!this.forms.has(id)) this.forms.set(id, { note: '', providerId: '', confirmed: false });
        return this.forms.get(id)!;
    }
    statusKind(status: string): PillKind {
        return status === 'delivered' ? 'green' : status === 'shipped' ? 'blue'
            : ['returned', 'cancelled'].includes(status) ? 'grey' : 'gold';
    }
    canManage() {
        return ['owner', 'admin'].includes(this.auth.user()?.role || '');
    }
    async act(id: string, action: string) {
        this.busy.set(true);
        this.error.set('');
        try {
            const updated = await firstValueFrom(this.api.post<Order>(
                `/admin/orders/${encodeURIComponent(this.order.id)}/deliveries/${id}/action`,
                { action, ...this.form(id) },
            ));
            this.updated.emit(updated);
            this.forms.delete(id);
        } catch (e: any) {
            this.error.set(e?.error?.message || this.t('fulfillment.loadError'));
        } finally {
            this.busy.set(false);
        }
    }
}
