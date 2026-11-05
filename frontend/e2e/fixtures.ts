import { expect, test as base } from '@playwright/test';

/** One Content-Security-Policy violation the page reported, as the browser describes it. */
export type PolicyViolation = { directive: string; blocked: string; source: string; page: string };

type Fixtures = {
  /** The violations the page reported so far; any left at the end of a test fails it. */
  policyViolations: PolicyViolation[];
};

type Options = {
  /** The BFF of the project's stack, which serves the bundle with the console's page headers. */
  bffURL: string;
};

declare global {
  interface Window {
    reportPolicyViolation?: (violation: PolicyViolation) => void;
  }
}

/** Paths the BFF answers with something other than a page. */
const notAPage = /^\/(?:api\/|perses\/api\/|assets\/|ai_grid\.v1\.)/;

/**
 * Every spec's page loads under the policy the deployed console sends. `vite preview` serves the
 * bundle and proxies the API (playwright.config.ts) but sends none of the BFF's headers, so each
 * page itself, the document a navigation loads, comes from the stack's BFF, which serves the same
 * bundle (`--static-assets-dir`) with its Content-Security-Policy (bff/internal/api/static.go).
 * The page reports each violation of the policy, and a test that ends with any fails.
 */
export const test = base.extend<Fixtures, Options>({
  bffURL: ['', { option: true, scope: 'worker' }],
  // Playwright reads a fixture's dependencies from the destructuring pattern; this one has none.
  // eslint-disable-next-line no-empty-pattern
  policyViolations: async ({}, provide) => provide([]),
  page: async ({ page, baseURL, bffURL, policyViolations }, provide) => {
    expect(bffURL, 'the project sets bffURL (playwright.config.ts)').not.toBe('');
    const origin = new URL(baseURL!).origin;
    await page.exposeFunction('reportPolicyViolation', (violation: PolicyViolation) =>
      policyViolations.push(violation),
    );
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) =>
        window.reportPolicyViolation?.({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
          source: `${event.sourceFile}:${event.lineNumber}`,
          page: location.pathname,
        }),
      );
    });
    await page.route(
      (url) => url.origin === origin && !notAPage.test(url.pathname),
      async (route) => {
        const request = route.request();
        if (!request.isNavigationRequest()) {
          return route.fallback();
        }
        const { pathname, search } = new URL(request.url());
        const response = await route.fetch({ url: bffURL + pathname + search });
        expect(
          response.headers()['content-security-policy'],
          `${bffURL} serves the bundle with the page headers: start it with --static-assets-dir`,
        ).toBeTruthy();
        return route.fulfill({ response });
      },
    );
    await provide(page);
    // A round trip, so that the reports of the test's last steps have arrived.
    await page.evaluate(() => 0).catch(() => undefined);
    expect(policyViolations, 'Content-Security-Policy violations').toEqual([]);
  },
});

export { expect };
