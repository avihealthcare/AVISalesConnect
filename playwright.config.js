import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { defineConfig } from '@playwright/test';

const status = parseEnv(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'env'], {
  encoding: 'utf8',
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
}));
if (status.API_URL !== 'http://127.0.0.1:54321' || !status.ANON_KEY) {
  throw new Error('Start the disposable local Supabase stack before running browser tests.');
}

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:5173' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    env: {
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'phone', use: { viewport: { width: 360, height: 780 }, hasTouch: true } },
  ],
});
