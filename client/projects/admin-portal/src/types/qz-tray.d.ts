declare module 'qz-tray' {
  interface QzConfig {}

  interface QzApi {
    security: {
      setCertificatePromise(handler: () => Promise<string>, options?: { rejectOnFailure?: boolean }): void;
      setSignatureAlgorithm(algorithm: 'SHA512'): void;
      setSignaturePromise(handler: (request: string) => Promise<string>): void;
    };
    websocket: {
      isActive(): boolean;
      connect(options?: { retries?: number; delay?: number }): Promise<void>;
      disconnect(): Promise<void>;
    };
    printers: {
      find(query?: string): Promise<string | string[]>;
    };
    configs: {
      create(printer: string, options?: Record<string, unknown>): QzConfig;
    };
    print(config: QzConfig, data: Array<string | Record<string, unknown>>): Promise<void>;
  }

  const qz: QzApi;
  export default qz;
}
