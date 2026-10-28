import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; the AI Grid map uses one to resize Leaflet (the PoC's test-setup.ts, B10).
// Assigned rather than vi.stubGlobal'd: `unstubGlobals` would remove it after a file's first test.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;

// No test reaches the network. A test that needs fetch stubs it (vi.stubGlobal, vi.spyOn, or a
// fetch passed in); one that forgets fails with the URL instead of calling the real one.
globalThis.fetch = (input) => Promise.reject(new Error(`unstubbed fetch: ${String(input)}`));
