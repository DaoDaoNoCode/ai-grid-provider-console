/**
 * How the console's router renders a navigation (main.tsx's BrowserRouter, and the tests' routers).
 *
 * Not as a React transition, which React Router 7 uses by default: then a URL change (a page's
 * filters, Perses's time range and variables) renders in slices, and React 18 loses a class
 * component's setState that lands between two slices if the render then reaches that component
 * (its interleaved update queue; React 19 fixes it, facebook/react#24663, but Perses 0.54 supports
 * only React 18). Perses's time range menu hit it: its closing transition's last setState was
 * lost, so the menu never unmounted and its invisible popover took every click on the page.
 * The exit: React 19, once Perses supports it (perses/shared#390, open as of 2026-10-27; Perses
 * 0.55 still requires React 18), then drop this.
 */
export const routerProps = { useTransitions: false } as const;
