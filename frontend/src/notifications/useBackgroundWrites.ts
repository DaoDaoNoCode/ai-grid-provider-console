// The background writes' context and hook, in their own module so BackgroundWritesProvider.tsx
// exports only the provider.
import { createContext, useContext } from 'react';
import type { WriteTarget } from './writeText';

/**
 * How a write ended for the form: `done` when the backend answered within the form's short wait
 * (the form shows its success notice), `pending` when the notification center took it over (the
 * form leaves as on success, without a notice: the center has shown its own).
 */
export type WriteOutcome = 'done' | 'pending';

export type BackgroundWritesValue = {
  /**
   * Sends a write from the app root, so it keeps running after the form unmounts. Resolves within
   * the form's short wait; rejects only with a definite failure that came back within it, which
   * the form shows as today.
   */
  submitWrite: (target: WriteTarget, send: () => Promise<unknown>) => Promise<WriteOutcome>;
};

export const BackgroundWritesContext = createContext<BackgroundWritesValue>({
  // Without the provider (a component test of its own), a write is what it always was.
  submitWrite: async (_target, send) => {
    await send();
    return 'done';
  },
});

export const useBackgroundWrites = () => useContext(BackgroundWritesContext);
