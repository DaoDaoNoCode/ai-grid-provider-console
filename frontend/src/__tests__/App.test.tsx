import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { MockConsoleService } from '../api/MockConsoleService';
import { ServiceError } from '../api/ConsoleService';

describe('App', () => {
  it('shows the signed-in user and the clusters from the service', async () => {
    const service = new MockConsoleService();
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('dev-user (provider admin)'));
    expect(await screen.findByRole('row', { name: /^site1 / })).toBeInTheDocument();
    expect(screen.getByText('brussels')).toBeInTheDocument();
    expect(screen.getAllByText('Provisioned')).toHaveLength(3);
  });

  it('has one h1, the page heading, with the masthead title as an h2', async () => {
    render(
      <MemoryRouter>
        <App service={new MockConsoleService()} />
      </MemoryRouter>,
    );
    await screen.findByRole('row', { name: /^site1 / });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Cloud Provider Admin Console' })).toBeVisible();
  });

  it('has one h1 on the AI Grid map, which has no visible page heading', async () => {
    render(
      <MemoryRouter initialEntries={['/ai-grid']}>
        <App service={new MockConsoleService()} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'AI Grid' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('does not call a viewer a provider admin', async () => {
    const service = new MockConsoleService({ username: 'viewer', groups: [], isProviderAdmin: false });
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('viewer'));
    expect(screen.getByTestId('masthead-user')).not.toHaveTextContent('provider admin');
  });

  it('navigates to organizations and shows them', async () => {
    render(
      <MemoryRouter>
        <App service={new MockConsoleService()} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Organizations' }));

    expect(await screen.findByRole('heading', { name: 'Organizations' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'acme-robotics' })).toBeInTheDocument();
    expect(screen.getByText('acme-robotics.example.com')).toBeInTheDocument();
  });

  it('shows a not-available state, not an error, when the backend lacks the RPC', async () => {
    const service = new MockConsoleService();
    service.listOrganizations = async () => {
      throw new ServiceError(501, 'the AI Grid backend does not support this operation yet');
    };
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Organizations' }));

    expect(await screen.findByText('Organizations are not available on this backend yet')).toBeInTheDocument();
    expect(screen.queryByText('Error loading organizations')).not.toBeInTheDocument();
  });

  it('shows the backend error when organizations cannot be loaded', async () => {
    const service = new MockConsoleService();
    service.listOrganizations = async () => {
      throw new ServiceError(502, 'the AI Grid backend failed to process the request');
    };
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('link', { name: 'Organizations' }));

    expect(await screen.findByText('Error loading organizations')).toBeInTheDocument();
    expect(screen.getByText('the AI Grid backend failed to process the request')).toBeInTheDocument();
  });
});

describe('user menu', () => {
  it('offers Log out through the login proxy when the backend is real', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App service={new MockConsoleService()} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: /dev-user/ }));
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveAttribute('href', '/oauth2/sign_out');
  });

  it('shows only the user on the fake backend, where no login proxy runs', async () => {
    const service = new MockConsoleService();
    const config = await service.getConfig();
    service.getConfig = async () => ({ ...config, fakeBackend: true });
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('dev-user'));
    expect(screen.queryByRole('button', { name: /dev-user/ })).not.toBeInTheDocument();
  });
});
