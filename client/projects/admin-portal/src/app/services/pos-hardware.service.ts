import { Injectable, computed, inject, signal } from '@angular/core';
import qz from 'qz-tray';
import { PosHardwareSettings, PosLocalStore } from './pos-local-store.service';
import { PosBusinessProfile, PosService } from './pos.service';
import { PosReceiptData, PosReceiptRenderer } from './pos-receipt-renderer.service';
import { ClientLoggerService, ClientLogSeverity } from './client-logger.service';

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
  private readonly clientLogger = inject(ClientLoggerService);
  readonly connected = signal(false);
  readonly configured = signal(false);
  readonly printerAvailable = signal(false);
  readonly signerReachable = signal<boolean | null>(null);
  readonly ready = computed(() => (
    this.configured()
    && this.connected()
    && this.printerAvailable()
    && this.signerReachable() === true
  ));
  private settings: PosHardwareSettings | null = null;
  private securityConfigured = false;
  private connectionCallbacksConfigured = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
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
      this.connected.set(false);
      this.printerAvailable.set(false);
      return;
    }
    this.configureSecurity();
    this.configureConnectionCallbacks();
    try {
      await this.connectAndVerifyPrinter(1, 0);
    } catch (error) {
      logError('initialize', error);
      this.connected.set(false);
      this.printerAvailable.set(false);
      this.logDurable('HARDWARE_INITIALIZE_FAILED', 'POS hardware initialization failed.', 'warn', {
        error: this.errorText(error),
      });
      this.scheduleReconnect();
    }
  }

  /**
   * A browser cannot keep QZ's websocket alive through a Windows/browser
   * restart. Instead, the register remembers the queue name and this
   * supervisor reconnects to QZ automatically for as long as the POS is
   * open. Closed/error callbacks also recover from QZ upgrades and crashes.
   */
  private configureConnectionCallbacks(): void {
    if (this.connectionCallbacksConfigured) return;
    const websocket = qz.websocket as typeof qz.websocket & {
      setClosedCallbacks?: (callback: () => void) => void;
      setErrorCallbacks?: (callback: (error: unknown) => void) => void;
    };
    websocket.setClosedCallbacks?.(() => this.handleDisconnect('QZ Tray connection closed'));
    websocket.setErrorCallbacks?.((error) => this.handleDisconnect('QZ Tray websocket error', error));
    this.connectionCallbacksConfigured = true;
  }

  private handleDisconnect(stage: string, error?: unknown): void {
    this.connected.set(false);
    this.printerAvailable.set(false);
    if (error) logError(stage, error);
    else logStage(stage);
    this.logDurable('QZ_DISCONNECTED', stage, 'warn', {
      error: error ? this.errorText(error) : null,
    });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (!this.settings?.printerName || this.reconnectTimer) return;
    const delays = [2000, 5000, 10000, 30000];
    const delayMs = delays[Math.min(this.reconnectAttempt, delays.length - 1)];
    this.reconnectAttempt += 1;
    logStage('QZ Tray reconnect scheduled', { delayMs, attempt: this.reconnectAttempt });
    this.logDurable('QZ_RECONNECT_SCHEDULED', 'QZ Tray automatic reconnect scheduled.', 'warn', {
      delayMs,
      attempt: this.reconnectAttempt,
    });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectAndVerifyPrinter(1, 0);
      } catch (error) {
        logError('QZ Tray automatic reconnect', error);
        this.connected.set(false);
        this.printerAvailable.set(false);
        this.logDurable('QZ_RECONNECT_FAILED', 'QZ Tray automatic reconnect failed.', 'warn', {
          attempt: this.reconnectAttempt,
          error: this.errorText(error),
        });
        this.scheduleReconnect();
      }
    }, delayMs);
  }

  private async connectAndVerifyPrinter(retries: number, delay: number): Promise<void> {
    if (!this.settings?.printerName) throw new Error('No receipt printer is configured.');
    const recovering = this.reconnectAttempt > 0;
    await this.connectWebsocket(retries, delay);
    this.connected.set(true);
    const result = await this.withTimeout(
      qz.printers.find(this.settings.printerName),
      this.PRINT_TIMEOUT_MS,
      'Configured printer check',
    );
    const matches = (Array.isArray(result) ? result : [result])
      .some((name) => String(name).trim() === this.settings?.printerName.trim());
    this.printerAvailable.set(matches);
    if (!matches) throw new Error(`Configured printer "${this.settings.printerName}" is not available in Windows.`);
    await this.checkSignerHealth();
    if (this.signerReachable() !== true) {
      throw new Error('The local POS device signer is not running on this register.');
    }
    if (recovering) {
      this.logDurable('HARDWARE_RESTORED', 'POS hardware connection restored automatically.', 'warn', {
        attempts: this.reconnectAttempt,
      });
    }
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async checkSignerHealth(): Promise<void> {
    const signer = this.settings?.deviceSignerUrl || 'http://127.0.0.1:8182';
    try {
      const response = await fetch(`${signer}/health`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      this.signerReachable.set(response.ok);
    } catch {
      this.signerReachable.set(false);
    }
  }

  private logDurable(
    code: string,
    message: string,
    severity: ClientLogSeverity,
    context: Record<string, unknown> = {},
  ): void {
    this.clientLogger.log({
      source: 'pos-client',
      severity,
      code,
      message,
      context: {
        printerName: this.settings?.printerName || null,
        signerUrl: this.settings?.deviceSignerUrl || 'http://127.0.0.1:8182',
        qzConnected: this.connected(),
        printerAvailable: this.printerAvailable(),
        signerReachable: this.signerReachable(),
        ...context,
      },
    });
  }

  private errorText(error: unknown): string {
    return String((error as { message?: string } | null)?.message || error || 'Unknown hardware error').slice(0, 500);
  }

  /**
   * Exposed so a print failure can be reported with the printer it was aimed
   * at — "printing failed" without the target queue name is not diagnosable
   * when a register has several installed printers.
   */
  printerName(): string | null {
    return this.settings?.printerName || null;
  }

  async configure(settings: PosHardwareSettings): Promise<void> {
    logStage('configure', { printerName: settings.printerName, drawerPulse: settings.drawerPulse });
    this.settings = settings;
    await this.local.setHardwareSettings(settings);
    this.configured.set(Boolean(settings.printerName));
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.initialize();
  }

  async printers(): Promise<string[]> {
    this.configureSecurity();
    try {
      await this.connectWebsocket(2, 1);
      const result = await this.withTimeout(qz.printers.find(), this.PRINT_TIMEOUT_MS, 'Printer discovery');
      const list = Array.isArray(result) ? result : [result];
      logStage('Printer discovery — found', { printers: list });
      return list;
    } catch (error) {
      this.logDurable('PRINTER_DISCOVERY_FAILED', 'QZ printer discovery failed.', 'warn', {
        error: this.errorText(error),
      });
      throw error;
    }
  }

  async printReceipt(receiptData: unknown, openDrawer = false): Promise<void> {
    logStage('printReceipt — start', {
      printerName: this.settings?.printerName || null,
      openDrawer,
      receiptNumber: (receiptData as PosReceiptData)?.receiptNumber,
    });
    const profile = await this.getBusinessProfile();
    logStage('printReceipt — business profile', { loaded: Boolean(profile) });
    const rendered = await this.renderer.render(receiptData as PosReceiptData, profile);
    await this.printRendered('printReceipt', rendered, openDrawer);
  }

  /** Z-report reprint/first-print — a cash/sales summary, never opens the drawer. */
  async printZReport(report: unknown): Promise<void> {
    logStage('printZReport — start', {
      printerName: this.settings?.printerName || null,
      zReportId: (report as { zReportId?: string })?.zReportId,
    });
    const profile = await this.getBusinessProfile();
    const rendered = await this.renderer.renderZReport(report as Parameters<PosReceiptRenderer['renderZReport']>[0], profile);
    await this.printRendered('printZReport', rendered, false);
  }

  private async printRendered(
    stage: string,
    rendered: { imageDataUrl: string; footerCommands: string },
    openDrawer: boolean,
  ): Promise<void> {
    if (!this.settings?.printerName) {
      const error = new Error('No receipt printer is configured.');
      logError(stage, error);
      throw error;
    }
    this.configureSecurity();
    await this.connectWebsocket(2, 1);
    // The receipt body is a rasterized image (Arabic needs real text shaping,
    // which raw ESC/POS text mode cannot do — see pos-receipt-renderer.service.ts)
    // printed through QZ's escpos image path; the QR/cut footer is still sent
    // as raw ESC/POS commands since it's not text.
    const data: Array<{ type: string; format: string; data: string; options?: Record<string, unknown> } | string> = [
      {
        type: 'raw',
        format: 'image',
        data: rendered.imageDataUrl,
        // QZ's default quantization ("alpha", threshold 127) applies a hard
        // black/white cutoff per pixel — a real test print showed this
        // dropping thin anti-aliased strokes out of small canvas-rendered
        // text (whole letters vanishing mid-word). "dither" spreads the
        // rounding error across neighboring pixels instead of a hard cutoff,
        // which reads far more faithfully for text at this size/DPI.
        options: { language: 'escpos', dotDensity: 'double', quantization: 'dither' },
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
      this.printerAvailable.set(true);
      logStage(`${stage} — done`, { printerName: this.settings.printerName });
    } catch (error) {
      this.connected.set(false);
      this.printerAvailable.set(false);
      this.scheduleReconnect();
      logError(stage, error, { printerName: this.settings.printerName });
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
      this.logDurable('DRAWER_OPEN_FAILED', 'Cash drawer command failed.', 'warn', {
        error: this.errorText(error),
        drawerPulse: this.settings.drawerPulse,
      });
      throw error;
    }
  }

  private configureSecurity(): void {
    if (this.securityConfigured) return;
    logStage('configureSecurity — installing QZ signature handlers');
    qz.security.setSignatureAlgorithm('SHA512');
    // QZ Tray's internal callCert/callSign helpers detect a genuine native
    // `async function` via `handler.constructor.name === "AsyncFunction"`
    // and call it directly; otherwise they fall back to a build-independent
    // shape. Angular's production build (esbuild) transpiles our `async`
    // class methods into a plain function wrapping a generator-runtime
    // helper — `fetchSignature(t){return C(this,null,function*(){...})}` —
    // so at runtime its constructor is just `Function`, never
    // `AsyncFunction`, no matter how it's declared in source or bound.
    // Relying on that constructor check is fragile against the build tool,
    // so both handlers use the documented fallback shapes instead, which
    // don't depend on how our async methods get compiled:
    //  - certHandler (qz-tray.js callCert): must itself BE the executor
    //    `(resolve, reject) => {...}` — QZ passes it straight into
    //    `new Promise(certHandler)`, it does not call it first.
    //  - signatureFactory (qz-tray.js callSign): must be a sync function
    //    that, given the string to sign, RETURNS an executor — QZ calls
    //    `signatureFactory(toSign)` and passes the result into `new Promise(...)`.
    qz.security.setCertificatePromise((resolve: (v: string) => void, reject: (e: unknown) => void) => {
      this.fetchCertificate().then(resolve, reject);
    }, { rejectOnFailure: true });
    qz.security.setSignaturePromise((request: string) => (resolve: (v: string) => void, reject: (e: unknown) => void) => {
      this.fetchSignature(request).then(resolve, reject);
    });
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
