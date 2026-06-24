import { Injectable, inject, signal } from '@angular/core';
import qz from 'qz-tray';
import { PosHardwareSettings, PosLocalStore } from './pos-local-store.service';
import { PosService } from './pos.service';
import { PosReceiptData, PosReceiptRenderer } from './pos-receipt-renderer.service';

@Injectable({ providedIn: 'root' })
export class PosHardwareService {
  private readonly pos = inject(PosService);
  private readonly local = inject(PosLocalStore);
  private readonly renderer = inject(PosReceiptRenderer);
  readonly connected = signal(false);
  readonly configured = signal(false);
  private settings: PosHardwareSettings | null = null;
  private securityConfigured = false;

  async initialize(): Promise<void> {
    this.settings = await this.local.getHardwareSettings();
    this.configured.set(Boolean(this.settings?.printerName));
    if (!this.settings?.printerName) return;
    this.configureSecurity();
    try {
      if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 1, delay: 0 });
      this.connected.set(true);
    } catch {
      this.connected.set(false);
    }
  }

  async configure(settings: PosHardwareSettings): Promise<void> {
    this.settings = settings;
    await this.local.setHardwareSettings(settings);
    this.configured.set(Boolean(settings.printerName));
    await this.initialize();
  }

  async printers(): Promise<string[]> {
    this.configureSecurity();
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 2, delay: 1 });
    const result = await qz.printers.find();
    return Array.isArray(result) ? result : [result];
  }

  async printReceipt(receiptData: unknown, openDrawer = false): Promise<void> {
    if (!this.settings?.printerName) throw new Error('No receipt printer is configured.');
    this.configureSecurity();
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 2, delay: 1 });
    const data = [this.renderer.render(receiptData as PosReceiptData)];
    if (openDrawer && this.settings.drawerPulse !== 'disabled') {
      data.push(this.renderer.drawerCommand(this.settings.drawerPulse));
    }
    const config = qz.configs.create(this.settings.printerName, { encoding: 'ISO-8859-1' });
    await qz.print(config, data);
    this.connected.set(true);
  }

  async openDrawer(): Promise<void> {
    if (!this.settings?.printerName || !this.settings || this.settings.drawerPulse === 'disabled') {
      throw new Error('Cash drawer is not configured.');
    }
    this.configureSecurity();
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 2, delay: 1 });
    const config = qz.configs.create(this.settings.printerName, { encoding: 'ISO-8859-1' });
    await qz.print(config, [this.renderer.drawerCommand(this.settings.drawerPulse)]);
  }

  private configureSecurity(): void {
    if (this.securityConfigured) return;
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setCertificatePromise(() => this.fetchCertificate(), { rejectOnFailure: true });
    qz.security.setSignaturePromise((request) => this.fetchSignature(request));
    this.securityConfigured = true;
  }

  private async fetchCertificate(): Promise<string> {
    try {
      return await this.fetchText(this.pos.certificateUrl, { credentials: 'include' });
    } catch (onlineError) {
      const signer = this.settings?.deviceSignerUrl || 'http://127.0.0.1:8182';
      try {
        return await this.fetchText(`${signer}/qz/certificate`);
      } catch {
        throw onlineError;
      }
    }
  }

  private async fetchSignature(request: string): Promise<string> {
    try {
      return await this.fetchText(this.pos.signingUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request }),
      });
    } catch (onlineError) {
      const signer = this.settings?.deviceSignerUrl || 'http://127.0.0.1:8182';
      try {
        return await this.fetchText(`${signer}/qz/sign`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request }),
        });
      } catch {
        throw onlineError;
      }
    }
  }

  private async fetchText(url: string, init?: RequestInit): Promise<string> {
    const response = await fetch(url, { cache: 'no-store', ...init });
    if (!response.ok) throw new Error(`Hardware signer returned ${response.status}.`);
    return response.text();
  }
}
