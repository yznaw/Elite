import { Injectable, inject, signal } from '@angular/core';
import qz from 'qz-tray';
import { PosHardwareSettings, PosLocalStore } from './pos-local-store.service';
import { PosBusinessProfile, PosService } from './pos.service';
import { PosReceiptData, PosReceiptRenderer } from './pos-receipt-renderer.service';

/**
 * Every stage of talking to real hardware (QZ websocket, cert/signature
 * fetch, printer discovery, the print call itself) used to fail silently
 * behind a single generic timeout message. A cashier standing at a register
 * with a jammed printer or a stopped QZ Tray service had nothing to go on.
 * This groups each attempt in the console with a stage name, timing, and the
 * real underlying error, so opening DevTools on the actual terminal is
 * enough to diagnose it without reproducing the issue remotely.
 */
const LOG_PREFIX = '[pos-hardware]';

function logStage(stage: string, detail?: Record<string, unknown>): void {
  console.log(`${LOG_PREFIX} ${stage}`, detail ?? '');
}

function logError(stage: string, error: unknown, detail?: Record<string, unknown>): void {
  console.error(`${LOG_PREFIX} ${stage} FAILED`, { error, ...detail });
}

@Injectable({ providedIn: 'root' })
export class PosHardwareService {
  private readonly pos = inject(PosService);
  private readonly local = inject(PosLocalStore);
  private readonly renderer = inject(PosReceiptRenderer);
  readonly connected = signal(false);
  readonly configured = signal(false);
  private settings: PosHardwareSettings | null = null;
  private securityConfigured = false;
  private businessProfile: PosBusinessProfile | null = null;
  private businessProfileFetchedAt = 0;
  private readonly BUSINESS_PROFILE_TTL_MS = 5 * 60 * 1000;

  private async getBusinessProfile(): Promise<PosBusinessProfile | null> {
    const stale = Date.now() - this.businessProfileFetchedAt > this.BUSINESS_PROFILE_TTL_MS;
    if (!stale) return this.businessProfile;
    try {
      this.businessProfile = await this.pos.businessProfile();
    } catch {
      // Printing must not fail because the profile fetch failed (e.g. offline)
      // — fall back to whatever was last cached, or the renderer's defaults.
    }
    this.businessProfileFetchedAt = Date.now();
    return this.businessProfile;
  }

  // QZ Tray calls (websocket connect, print) can hang indefinitely when the
  // signing chain fails — e.g. a certificate/signature promise that never
  // settles. Because these are awaited inside the POS component's `busy`
  // guard, a hang leaves `busy=true` forever, which silently disables
  // "Take payment" for every subsequent sale. Every QZ call below is wrapped
  // in withTimeout so it always settles (resolve or reject) and the UI never
  // gets stuck. Printing is best-effort; selling must never depend on it.
  private readonly CONNECT_TIMEOUT_MS = 8000;
  private readonly PRINT_TIMEOUT_MS = 15000;

  private async withTimeout<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = performance.now();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`)), ms);
    });
    try {
      const result = await Promise.race([operation, timeout]);
      logStage(`${label} ok`, { ms: Math.round(performance.now() - startedAt) });
      return result;
    } catch (error) {
      logError(label, error, { elapsedMs: Math.round(performance.now() - startedAt), timeoutMs: ms });
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async connectWebsocket(retries: number, delay: number): Promise<void> {
    if (qz.websocket.isActive()) {
      logStage('QZ Tray connection — already active');
      return;
    }
    logStage('QZ Tray connection — connecting', { retries, delay });
    await this.withTimeout(qz.websocket.connect({ retries, delay }), this.CONNECT_TIMEOUT_MS, 'QZ Tray connection');
  }

  async initialize(): Promise<void> {
    this.settings = await this.local.getHardwareSettings();
    this.configured.set(Boolean(this.settings?.printerName));
    logStage('initialize', { printerName: this.settings?.printerName || null, deviceSignerUrl: this.settings?.deviceSignerUrl || null });
    if (!this.settings?.printerName) {
      logStage('initialize — no printer configured, skipping connect');
      return;
    }
    this.configureSecurity();
    try {
      await this.connectWebsocket(1, 0);
      this.connected.set(true);
    } catch (error) {
      logError('initialize', error);
      this.connected.set(false);
    }
  }

  async configure(settings: PosHardwareSettings): Promise<void> {
    logStage('configure', { printerName: settings.printerName, drawerPulse: settings.drawerPulse });
    this.settings = settings;
    await this.local.setHardwareSettings(settings);
    this.configured.set(Boolean(settings.printerName));
    await this.initialize();
  }

  async printers(): Promise<string[]> {
    this.configureSecurity();
    await this.connectWebsocket(2, 1);
    const result = await this.withTimeout(qz.printers.find(), this.PRINT_TIMEOUT_MS, 'Printer discovery');
    const list = Array.isArray(result) ? result : [result];
    logStage('Printer discovery — found', { printers: list });
    return list;
  }

  async printReceipt(receiptData: unknown, openDrawer = false): Promise<void> {
    logStage('printReceipt — start', {
      printerName: this.settings?.printerName || null,
      openDrawer,
      receiptNumber: (receiptData as PosReceiptData)?.receiptNumber,
    });
    if (!this.settings?.printerName) {
      const error = new Error('No receipt printer is configured.');
      logError('printReceipt', error);
      throw error;
    }
    this.configureSecurity();
    await this.connectWebsocket(2, 1);
    const profile = await this.getBusinessProfile();
    logStage('printReceipt — business profile', { loaded: Boolean(profile) });
    const rendered = this.renderer.render(receiptData as PosReceiptData, profile);
    // The receipt body is a rasterized image (Arabic needs real text shaping,
    // which raw ESC/POS text mode cannot do — see pos-receipt-renderer.service.ts)
    // printed through QZ's escpos image path; the QR/cut footer is still sent
    // as raw ESC/POS commands since it's not text.
    const data: Array<{ type: string; format: string; data: string; options?: Record<string, unknown> } | string> = [
      {
        type: 'raw',
        format: 'image',
        data: rendered.imageDataUrl,
        options: { language: 'escpos', dotDensity: 'double' },
      },
      rendered.footerCommands,
    ];
    if (openDrawer && this.settings.drawerPulse !== 'disabled') {
      data.push(this.renderer.drawerCommand(this.settings.drawerPulse));
    }
    const config = qz.configs.create(this.settings.printerName);
    try {
      await this.withTimeout(qz.print(config, data), this.PRINT_TIMEOUT_MS, 'Receipt printing');
      this.connected.set(true);
      logStage('printReceipt — done', { printerName: this.settings.printerName });
    } catch (error) {
      this.connected.set(false);
      logError('printReceipt', error, { printerName: this.settings.printerName });
      throw error;
    }
  }

  async openDrawer(): Promise<void> {
    logStage('openDrawer — start', { drawerPulse: this.settings?.drawerPulse || null });
    if (!this.settings?.printerName || !this.settings || this.settings.drawerPulse === 'disabled') {
      const error = new Error('Cash drawer is not configured.');
      logError('openDrawer', error);
      throw error;
    }
    this.configureSecurity();
    await this.connectWebsocket(2, 1);
    const config = qz.configs.create(this.settings.printerName, { encoding: 'ISO-8859-1' });
    try {
      await this.withTimeout(qz.print(config, [this.renderer.drawerCommand(this.settings.drawerPulse)]), this.PRINT_TIMEOUT_MS, 'Cash drawer');
      logStage('openDrawer — done');
    } catch (error) {
      logError('openDrawer', error);
      throw error;
    }
  }

  private configureSecurity(): void {
    if (this.securityConfigured) return;
    logStage('configureSecurity — installing QZ signature handlers');
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setCertificatePromise(() => this.fetchCertificate(), { rejectOnFailure: true });
    qz.security.setSignaturePromise((request) => this.fetchSignature(request));
    this.securityConfigured = true;
  }

  private async fetchCertificate(): Promise<string> {
    try {
      const cert = await this.fetchText(this.pos.certificateUrl, { credentials: 'include' });
      logStage('fetchCertificate — via API', { url: this.pos.certificateUrl });
      return cert;
    } catch (onlineError) {
      logError('fetchCertificate — via API, falling back to local signer', onlineError, { url: this.pos.certificateUrl });
      const signer = this.settings?.deviceSignerUrl || 'http://127.0.0.1:8182';
      try {
        const cert = await this.fetchText(`${signer}/qz/certificate`);
        logStage('fetchCertificate — via local signer', { signer });
        return cert;
      } catch (signerError) {
        logError('fetchCertificate — local signer also failed', signerError, { signer });
        throw onlineError;
      }
    }
  }

  private async fetchSignature(request: string): Promise<string> {
    try {
      const signature = await this.fetchText(this.pos.signingUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request }),
      });
      logStage('fetchSignature — via API', { url: this.pos.signingUrl });
      return signature;
    } catch (onlineError) {
      logError('fetchSignature — via API, falling back to local signer', onlineError, { url: this.pos.signingUrl });
      const signer = this.settings?.deviceSignerUrl || 'http://127.0.0.1:8182';
      try {
        const signature = await this.fetchText(`${signer}/qz/sign`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request }),
        });
        logStage('fetchSignature — via local signer', { signer });
        return signature;
      } catch (signerError) {
        logError('fetchSignature — local signer also failed', signerError, { signer });
        throw onlineError;
      }
    }
  }

  private async fetchText(url: string, init?: RequestInit): Promise<string> {
    const response = await fetch(url, { cache: 'no-store', ...init });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Hardware signer returned ${response.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}.`);
    }
    return response.text();
  }
}
