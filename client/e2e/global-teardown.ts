import { execFileSync } from 'node:child_process';
import path from 'node:path';

export default function globalTeardown(): void {
  execFileSync(process.execPath, ['scripts/cleanup-pos-browser-e2e.js'], {
    cwd: path.resolve(process.cwd(), '../server'),
    env: { ...process.env, DEFAULT_TENANT_SLUG: 'pos-browser-e2e' },
    stdio: 'inherit',
  });
}
