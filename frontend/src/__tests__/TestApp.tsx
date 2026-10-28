import { useMemo } from 'react';
import { App } from '../App';
import type { ConsoleService } from '../api/ConsoleService';
import { transportFor, type ClusterSource } from './connectClusters';

/**
 * The console as a test renders it: the backend's Clusters API over Connect answers from the
 * service's clusters (connectClusters.ts) unless the test gives a transport of its own.
 */
export const TestApp: React.FC<React.ComponentProps<typeof App> & { service: ConsoleService & ClusterSource }> = (
  props,
) => {
  const fallback = useMemo(() => transportFor(props.service), [props.service]);
  return <App {...props} transport={props.transport ?? fallback} />;
};
