// @vitest-environment jsdom
// jsdom: renders the hook and watches the class on <html>.
import { act, cleanup, renderHook } from '@testing-library/react';
import { usePageTheme } from './pageTheme';

// Unmounted first, so the class removal reaches no observer outside act.
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('pf-v6-theme-dark');
});

// An async act lets the MutationObserver's callback, a microtask, run inside it.
it("follows PatternFly's dark class on <html> as it is added and removed", async () => {
  const { result } = renderHook(() => usePageTheme());
  expect(result.current).toBe('light');
  await act(async () => document.documentElement.classList.add('pf-v6-theme-dark'));
  expect(result.current).toBe('dark');
  await act(async () => document.documentElement.classList.remove('pf-v6-theme-dark'));
  expect(result.current).toBe('light');
});

it('starts dark on a page that already is', () => {
  document.documentElement.classList.add('pf-v6-theme-dark');
  expect(renderHook(() => usePageTheme()).result.current).toBe('dark');
});
