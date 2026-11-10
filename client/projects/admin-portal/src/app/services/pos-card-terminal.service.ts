import { Injectable, inject, signal } from '@angular/core';
import { PosLocalStore } from './pos-local-store.service';

/**
 * Talks to the Elite Card Bridge, the small Windows service on an integrated
 * till that drives the QNB terminal through the bank's DLL
 * (tools/elite-card-bridge, docs/39). The bridge only runs the terminal and
 * journals each operation; amounts, sales and permissions stay with the POS
 * and the Elite API.
 */

/** Result of one terminal operation, as the bridge returns it. Never holds a
    full card number: only the masked PAN the slip prints. */
export interface PosCardResult {
  outcome: 'approved' | 'declined' | 'cancelled' | 'unknown' | 'error' | 'ok';
  code: string;
  message: string;
  terminalErrorCode?: number;
  hostResponseCode?: string;
  authCode?: string;
  maskedPan?: string;
  cardExpiry?: string;
  issuer?: string;
  tid?: string;
  mid?: string;
  seqNo?: string;
  invoiceNo?: string;
  hostTrace?: string;
  txnAt?: string;
  entryMethod?: string;
  pinVerified?: boolean;
  receiptText?: string;
  info?: Record<string, string>;
}

export interface PosTerminalMessage {
  code?: string;
  title: string;
  lines: string[];
}

export interface PosCardBridgeHealth {
  version: string;
  mode: 'real' | 'simulator';
  dllVersion: string;
  comPort: string;
  connected: boolean;
  busy: boolean;
}

export interface PosCardJobRequest {
  type: 'sale' | 'void' | 'refund' | 'logon' | 'logoff' | 'closeBatch' | 'summary' | 'audit'
    | 'reprintLast' | 'reprintInvoice' | 'initialize' | 'restart' | 'settings';
  utn?: string;
  amountCents?: number;
  original?: { seqNo: string; date: string; authCode: string; amountCents: number };
  /** Void: UTN of the sale being voided. */
  originalUtn?: string;
  invoiceNumber?: string;
}

export interface PosCardStatus {
  utn: string;
  status: 'approved' | 'declined' | 'reversed' | 'not_found' | 'in_progress' | 'unknown';
  source: string;
  result?: PosCardResult;
}

export class PosCardBridgeError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
  }
}

/** Plain text for the terminal's display codes (guide v1.29, Appendix D). */
const DISPLAY_TEXT: Record<string, string> = {
  '001': 'Insert, tap or swipe the card',
  '002': 'Processing with the bank…',
  '003': 'Customer is entering their PIN',
  '004': 'Customer is entering their PIN',
  '005': 'Remove the card',
  '007': 'Card machine not logged on',
  '009': 'Invoice not found',
  '010': 'Already voided',
  '011': 'Void not allowed',
};

@Injectable({ providedIn: 'root' })
export class PosCardTerminalService {
  private readonly local = inject(PosLocalStore);
  readonly baseUrl = 'http://127.0.0.1:8183/v1';
  /** Longest a terminal operation can take: DLL global timeout is 120 s. */
  private readonly jobTimeoutMs = 150_000;
  private key: string | null = null;

  readonly health = signal<PosCardBridgeHealth | null>(null);
  readonly reachable = signal<boolean | null>(null);
  /** Latest text on the terminal screen while an operation runs. */
  readonly message = signal<PosTerminalMessage | null>(null);

  async loadKey(): Promise<string | null> {
    this.key = await this.local.getCardBridgeKey().catch(() => null);
    return this.key;
  }

  async setKey(key: string): Promise<void> {
    this.key = key.trim() || null;
    await this.local.setCardBridgeKey(this.key ?? '');
  }

  hasKey(): boolean {
    return Boolean(this.key);
  }

  /**
   * UTN for one terminal operation: E + 5-char till code + yyMMddHHmmss + 2
   * random chars + retry digit 0 = 21 characters. The till code keeps it
   * unique across branches (the bank requires deployment-wide uniqueness),
   * the timestamp and random pair within a till. The DLL strips the last
   * digit as its retry counter.
   */
  newUtn(registerId: string, now = new Date()): string {
    const code = parseInt(registerId.replace(/-/g, '').slice(0, 8), 16).toString(36).toUpperCase().padStart(5, '0').slice(-5);
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const random = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => (b % 36).toString(36)).join('').toUpperCase();
    return `E${code}${stamp}${random}0`;
  }

  /** Display line for the cashier, from the terminal's message. */
  describe(message: PosTerminalMessage | null): string {
    if (!message) return 'Waiting for the card machine…';
    if (message.code && DISPLAY_TEXT[message.code]) return DISPLAY_TEXT[message.code];
    return [message.title, ...message.lines].map((line) => line.trim()).filter(Boolean).join(' · ') || 'Waiting for the card machine…';
  }

  async checkHealth(): Promise<PosCardBridgeHealth | null> {
    try {
      const health = await this.request<PosCardBridgeHealth>('GET', '/health', undefined, 4000);
      this.health.set(health);
      this.reachable.set(true);
      return health;
    } catch {
      this.health.set(null);
      this.reachable.set(false);
      return null;
    }
  }

  /**
   * Runs one operation to the end and returns its result. A lost bridge or
   * a job that outlives the DLL timeout comes back as outcome "unknown": the
   * caller must check the status by UTN before doing anything else.
   */
  async run(job: PosCardJobRequest): Promise<PosCardResult> {
    this.message.set(null);
    let jobId: string;
    try {
      const started = await this.request<{ jobId: string; state: string; result?: PosCardResult }>('POST', '/jobs', job, 8000);
      if (started.state === 'done' && started.result) return started.result;
      jobId = started.jobId;
    } catch (error) {
      if (error instanceof PosCardBridgeError && error.status > 0) {
        // The bridge answered and refused (busy, bad input, key): nothing ran.
        return { outcome: 'error', code: error.code, message: error.message };
      }
      // Not even sure the request arrived: a financial job may be running.
      return job.utn
        ? { outcome: 'unknown', code: 'BRIDGE_UNREACHABLE', message: 'Lost contact with the card bridge.' }
        : { outcome: 'error', code: 'BRIDGE_UNREACHABLE', message: 'The card bridge on this till is not running.' };
    }

    const deadline = Date.now() + this.jobTimeoutMs;
    let failures = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        const state = await this.request<{ state: string; message?: PosTerminalMessage; result?: PosCardResult }>('GET', `/jobs/${jobId}`, undefined, 5000);
        failures = 0;
        if (state.message) this.message.set(state.message);
        if (state.state === 'done' && state.result) return state.result;
      } catch {
        failures += 1;
        if (failures >= 8) break;
      }
    }
    return { outcome: 'unknown', code: 'BRIDGE_TIMEOUT', message: 'No final answer from the card machine.' };
  }

  async status(utn: string): Promise<PosCardStatus> {
    try {
      return await this.request<PosCardStatus>('GET', `/transactions/${encodeURIComponent(utn)}`, undefined, 30000);
    } catch {
      return { utn, status: 'unknown', source: 'unreachable' };
    }
  }

  /** Asks a few times, a few seconds apart: right after a cable blip the
      terminal can still be busy finishing the operation. */
  async resolve(utn: string, attempts = 4): Promise<PosCardStatus> {
    let last: PosCardStatus = { utn, status: 'unknown', source: 'none' };
    for (let i = 0; i < attempts; i += 1) {
      last = await this.status(utn);
      if (last.status !== 'unknown' && last.status !== 'in_progress') return last;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return last;
  }

  async ports(): Promise<{ ports: string[]; current: string }> {
    return this.request('GET', '/ports');
  }

  async setPort(comPort: string): Promise<PosCardBridgeHealth> {
    return this.request('PUT', '/config', { comPort });
  }

  /** Simulator only: choose what the next payment does. */
  async simulateNext(scenario: string): Promise<void> {
    await this.request('POST', '/sim/next', { scenario });
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 10000): Promise<T> {
    if (path !== '/health' && !this.key) await this.loadKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.key ? { 'X-Elite-Bridge-Key': this.key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        // The bridge is on loopback; Chrome asks for Private Network Access.
        targetAddressSpace: 'loopback',
      } as RequestInit);
      const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; code?: string; message?: string } | null;
      if (!response.ok || !payload?.success) {
        throw new PosCardBridgeError(payload?.code || `HTTP_${response.status}`, payload?.message || 'The card bridge refused the request.', response.status);
      }
      return payload.data as T;
    } catch (error) {
      if (error instanceof PosCardBridgeError) throw error;
      throw new PosCardBridgeError('BRIDGE_UNREACHABLE', 'The card bridge on this till is not running.');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Terminal result → the whitelisted fields the Elite API stores. */
export function toServerCardResult(result: PosCardResult, status: 'approved' | 'declined' | 'cancelled' | 'unknown' | 'reversed') {
  return {
    status,
    errorCode: result.code || undefined,
    message: result.message || undefined,
    hostResponseCode: result.hostResponseCode,
    authCode: result.authCode,
    maskedPan: result.maskedPan,
    cardExpiry: result.cardExpiry,
    issuer: result.issuer,
    tid: result.tid,
    mid: result.mid,
    seqNo: result.seqNo,
    invoiceNo: result.invoiceNo,
    hostTrace: result.hostTrace,
    txnAt: result.txnAt,
    entryMethod: result.entryMethod,
    pinVerified: result.pinVerified,
    receiptText: result.receiptText,
  };
}

/** DDMMYY of an ISO time in Qatar, for EnhanceRefund's original date. */
export function qatarDdMmYy(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Qatar', day: '2-digit', month: '2-digit', year: '2-digit' })
    .formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}${get('month')}${get('year')}`;
}
