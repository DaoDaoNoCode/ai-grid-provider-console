/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Local development against a real cluster.
 *
 * The BFF expects the caller's OpenShift token in `x-forwarded-access-token`,
 * which kube-auth-proxy sets in a deployed console. Here the dev proxy sets it
 * from `oc whoami -t`, so whoever ran `oc login` is the console user. The token
 * is re-read after a 401 so a fresh `oc login` is picked up without a restart.
 *
 * Environment:
 *   BFF_URL     BFF base URL (default http://127.0.0.1:8080)
 *   AUTH_TOKEN  use this token instead of running `oc whoami -t`
 */
const bffUrl = process.env.BFF_URL ?? 'http://127.0.0.1:8080';
const tokenHeader = process.env.AUTH_TOKEN_HEADER ?? 'x-forwarded-access-token';

let cachedToken: string | undefined;

const readToken = (): string => {
  if (process.env.AUTH_TOKEN) {
    return process.env.AUTH_TOKEN;
  }
  if (cachedToken) {
    return cachedToken;
  }
  try {
    cachedToken = execFileSync('oc', ['whoami', '-t'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const user = execFileSync('oc', ['whoami'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    console.info(`[dev-proxy] forwarding API calls to ${bffUrl} as ${user}`);
  } catch {
    cachedToken = '';
    console.warn('[dev-proxy] no oc login found; API calls will fail with 401 until you run `oc login`');
  }
  return cachedToken;
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 9000,
    strictPort: true,
    proxy: {
      '/api': {
        target: bffUrl,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = readToken();
            if (token) {
              proxyReq.setHeader(tokenHeader, token);
            }
          });
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.statusCode === 401) {
              cachedToken = undefined;
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
