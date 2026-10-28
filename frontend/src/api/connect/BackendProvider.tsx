import { useMemo, useState } from 'react';
import type { Interceptor, Transport } from '@connectrpc/connect';
import { TransportProvider } from '@connectrpc/connect-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConsoleTransport, sessionCheck } from './transport';

/**
 * A transport built with the console's interceptors (the session check), as fakeClients takes
 * them: a test's backend then ends the session on Unauthenticated exactly as the browser's does.
 */
export type TransportWith = (interceptors: Interceptor[]) => Transport;

type Props = {
  children: React.ReactNode;
  /** The browser's transport by default; a test gives one, or one built with the console's interceptors. */
  transport?: Transport | TransportWith;
  checkSession: () => void;
};

export const BackendProvider: React.FC<Props> = ({ children, transport, checkSession }) => {
  const [client] = useState(() => new QueryClient());
  const used = useMemo(
    () =>
      typeof transport === 'function'
        ? transport([sessionCheck(checkSession)])
        : (transport ?? createConsoleTransport({ checkSession })),
    [transport, checkSession],
  );
  return (
    <TransportProvider transport={used}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TransportProvider>
  );
};
