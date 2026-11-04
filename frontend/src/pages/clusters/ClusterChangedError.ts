import type { ClusterView } from './clusterView';

/**
 * What onConfirm throws when the cluster changed since the dialog loaded it (a 409): `current` is
 * the cluster as the backend has it now, or undefined when it couldn't be loaded again.
 */
export class ClusterChangedError extends Error {
  constructor(readonly current?: ClusterView) {
    super('The cluster was changed after this dialog opened.');
    this.name = 'ClusterChangedError';
  }
}

/**
 * What a dialog says after a conflict. With `current`, the page has given the dialog that version,
 * so a second try sends it.
 */
export const changedMessage = (err: ClusterChangedError) =>
  err.current
    ? 'This cluster was changed after this dialog opened. The latest version is now shown. Review it and try again.'
    : 'This cluster was changed after this dialog opened, and the latest version could not be loaded. Cancel, refresh the page, and try again.';
