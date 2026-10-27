import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useQuery } from '@connectrpc/connect-query';
import { App } from '../App';
import { MockConsoleService } from '../api/MockConsoleService';
import { fakeClients } from '../api/connect/testing';
import { ping } from '../gen/ai_grid/v1/ai_grid_service-AiGrid_connectquery';

// A page stands in for the routes: what any page under App gets is the root's Connect Query setup.
vi.mock('../AppRoutes', () => ({
  AppRoutes: () => {
    const { data } = useQuery(ping, { name: 'console' });
    return <p>{data?.message ?? 'waiting'}</p>;
  },
}));

it('gives every page a Connect transport and a query cache at the root', async () => {
  const { transport } = fakeClients({ aiGrid: { ping: (req) => ({ message: `hello ${req.name}` }) } });
  render(
    <MemoryRouter>
      <App service={new MockConsoleService()} transport={transport} />
    </MemoryRouter>,
  );
  expect(await screen.findByText('hello console')).toBeInTheDocument();
});
