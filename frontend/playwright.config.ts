import { defineConfig, devices } from '@playwright/test';

// The stack's ports default to the ones `make dev-fake-poc` documents. Set them when
// another process already holds a default (for example a PoC on :8080); CI keeps the defaults.
const port = process.env.E2E_FRONTEND_PORT ?? '9000';
const bffPort = process.env.E2E_BFF_PORT ?? '8080';
const backendPort = process.env.E2E_BACKEND_PORT ?? '9090';
const hubPort = process.env.E2E_HUB_PORT ?? '9091';
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  // A test.only left in a commit would otherwise make CI run that one test and pass.
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: origin,
    colorScheme: 'light',
    trace: 'retain-on-failure',
    // Without these an action or a navigation that never completes uses up the whole test
    // timeout and is reported as a bare test timeout; with them the failure names the line.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  // The stack of `make dev-fake-poc`, but with the frontend as it ships: the production bundle,
  // served by `vite preview`, whose proxy is the dev server's (vite.config.ts), so the identity
  // headers are the same. The dev server's unbundled modules and React's development build
  // made pages load in seconds and reported errors React's production build does not.
  // Playwright starts the three in parallel and fails the run at once if one exits before it answers.
  // Outside CI it reuses whatever already answers on the ports, `make dev-fake-poc` included.
  webServer: [
    {
      // The PoC preset (mock/fixtures-poc): the specs use the PoC's site, model and pin names.
      command: 'make -C ../bff fake-backend',
      port: Number(backendPort),
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        FIXTURES: '../mock/fixtures-poc',
        BACKEND_ADDRESS: `127.0.0.1:${backendPort}`,
        FAKE_HUB_ADDRESS: `127.0.0.1:${hubPort}`,
      },
    },
    {
      command: 'make -C ../bff run-fake',
      url: `http://127.0.0.1:${bffPort}/healthcheck`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        PORT: bffPort,
        BACKEND_ADDRESS: `127.0.0.1:${backendPort}`,
        FAKE_HUB_ADDRESS: `127.0.0.1:${hubPort}`,
      },
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
      // An API path, so the run starts once the proxy reaches the BFF and the BFF the fake.
      url: `${origin}/api/v1/clusters`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        BFF_URL: `http://127.0.0.1:${bffPort}`,
        AUTH_TOKEN: 'dev-token',
        AUTH_USER: 'dev-user',
      },
    },
  ],
});
