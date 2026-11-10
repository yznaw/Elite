declare module 'qz-tray' {
  interface QzConfig {}

  type QzResolverExecutor = (resolve: (value: string) => void, reject: (error: unknown) => void) => void;

  interface QzApi {
    security: {
      // QZ Tray's callCert/callSign accept either a genuine `async function`
      // (detected via `handler.constructor.name === "AsyncFunction"`, which
      // esbuild's downlevel output for our async class methods does NOT
      // preserve — see pos-hardware.service.ts's configureSecurity) or a
      // build-independent Promise-executor shape, which is what this project
      // uses. certHandler must itself be the executor; signatureFactory must
      // be a sync function that returns one, given the string to sign.
      setCertificatePromise(handler: QzResolverExecutor, options?: { rejectOnFailure?: boolean }): void;
      setSignatureAlgorithm(algorithm: 'SHA512'): void;
      setSignaturePromise(handler: (request: string) => QzResolverExecutor): void;
    };
    websocket: {
      isActive(): boolean;
      connect(options?: { retries?: number; delay?: number }): Promise<void>;
      disconnect(): Promise<void>;
    };
    api: {
      /** Version of the QZ Tray *desktop app* that answered, not the npm package. */
      getVersion(): Promise<string>;
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
