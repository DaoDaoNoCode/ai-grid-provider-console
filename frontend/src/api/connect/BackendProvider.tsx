import { useMemo, useState } from 'react';
import type { Transport } from '@connectrpc/connect';
import { TransportProvider } from '@connectrpc/connect-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createConsoleTransport } from './transport';

type Props = {
  children: React.ReactNode;
  transport?: Transport;
  checkSession: () => void;
};

export const BackendProvider: React.FC<Props> = ({ children, transport, checkSession }) => {
  const [client] = useState(() => new QueryClient());
  const defaultTransport = useMemo(() => createConsoleTransport({ checkSession }), [checkSession]);
  return (
    <TransportProvider transport={transport ?? defaultTransport}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </TransportProvider>
  );
};
