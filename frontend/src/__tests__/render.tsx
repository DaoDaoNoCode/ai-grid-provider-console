import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import type { Transport } from '@connectrpc/connect';
import type { TransportWith } from '../api/connect/BackendProvider';
import type { ConsoleService } from '../api/ConsoleService';
import { routerProps } from '../router';
import { transportFor, type ClusterSource } from './connectClusters';

/** A promise the test settles by hand. */
export const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/**
 * Renders the whole console at `path`, as a deep link or a reload would; routed as main.tsx routes it.
 * The backend's Clusters API over Connect answers from the service's clusters (connectClusters.ts)
 * unless a test gives its own transport.
 */
export const renderAt = (
  path: string,
  service: ConsoleService & ClusterSource,
  transport: Transport | TransportWith = transportFor(service),
) =>
  render(
    <MemoryRouter initialEntries={[path]} {...routerProps}>
      <App service={service} transport={transport} />
    </MemoryRouter>,
  );
