import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // The menu keeps its name where a phone shows only its icon.
    expect(screen.getByRole('button', { name: 'User menu: dev-user (provider admin)' })).toBeInTheDocument();
    const row = await screen.findByRole('row', { name: /^site1 / });
    expect(within(row).getByText('4.22.15')).toBeInTheDocument();
    expect(screen.getAllByText('Provisioned')).toHaveLength(3);
  });

  it('has one h1, the page heading, first: the masthead title is not a heading', async () => {
    render(
      <MemoryRouter>
        <App service={new MockConsoleService()} />
      </MemoryRouter>,
    );
    await screen.findByRole('row', { name: /^site1 / });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading')[0]).toHaveTextContent('Clusters');
    expect(screen.getByText('Cloud Provider Admin Console')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Cloud Provider Admin Console' })).not.toBeInTheDocument();
  });

  it('starts with a Skip to content link to the main region', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App service={new MockConsoleService()} />
      </MemoryRouter>,
    );
    await screen.findByRole('row', { name: /^site1 / });
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#console-main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'console-main');
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

  it('opens About and offers Log out from the user menu even when the user could not be loaded', async () => {
    const service = new MockConsoleService();
    service.getUser = () => Promise.reject(new ServiceError(500, 'unavailable'));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );
    // Not a 401: somebody is signed in, the console just can't say who.
    await user.click(await screen.findByRole('button', { name: 'User menu: User could not be loaded' }));
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveAttribute('href', '/oauth2/sign_out');
    await user.click(screen.getByRole('menuitem', { name: 'About' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Console version');
    expect(screen.queryByTestId('session-ended-alert')).not.toBeInTheDocument();
  });

  it('opens About and offers Log out while the user is still loading', async () => {
    const service = new MockConsoleService();
    service.getUser = () => new Promise(() => {});
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'User menu: Signing in...' }));
    expect(screen.getByRole('menuitem', { name: 'About' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
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

  it('shows a viewer one empty state instead of the pages, which then load nothing', async () => {
    const service = new MockConsoleService({ username: 'viewer', groups: [], isProviderAdmin: false });
    const listClusters = vi.spyOn(service, 'listClusters');
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/clusters']}>
        <App service={service} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This console is for provider admins' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/You are signed in as viewer/)).toBeInTheDocument();
    expect(screen.queryByTestId('clusters-table')).not.toBeInTheDocument();
    const calls = listClusters.mock.calls.length;
    await user.click(screen.getByRole('link', { name: 'Organizations' }));
    expect(screen.getByRole('heading', { level: 1, name: 'This console is for provider admins' })).toBeInTheDocument();
    expect(screen.queryByText('Error loading organizations')).not.toBeInTheDocument();
    expect(listClusters).toHaveBeenCalledTimes(calls);
  });

  it('shows the pages when the user could not be loaded, without admin actions', async () => {
    const service = new MockConsoleService();
    service.getUser = () => Promise.reject(new ServiceError(500, 'unavailable'));
    render(
      <MemoryRouter initialEntries={['/clusters']}>
        <App service={service} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('row', { name: /^site1 / })).toBeInTheDocument();
    expect(screen.queryByText('This console is for provider admins')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Actions for / })).not.toBeInTheDocument();
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

  it('offers About but no Log out on the fake backend, where no login proxy runs', async () => {
    const service = new MockConsoleService();
    const config = await service.getConfig();
    service.getConfig = async () => ({ ...config, fakeBackend: true });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('dev-user'));
    await user.click(screen.getByRole('button', { name: /dev-user/ }));
    expect(screen.getByRole('menuitem', { name: 'About' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('shows the console version, the backend and the user in About', async () => {
    const service = new MockConsoleService();
    const config = await service.getConfig();
    service.getConfig = async () => ({ ...config, version: '1a2b3c4', fakeBackend: true });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App service={service} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('dev-user'));
    await user.click(screen.getByRole('button', { name: /dev-user/ }));
    await user.click(screen.getByRole('menuitem', { name: 'About' }));
    const about = await screen.findByRole('dialog', { name: 'Cloud Provider Admin Console' });
    expect(about).toHaveTextContent('Console version1a2b3c4');
    expect(about).toHaveTextContent('BackendFake backend (fixture data)');
    // The backend has no version RPC yet.
    expect(about).toHaveTextContent('Backend versionNot reported');
    expect(about).toHaveTextContent('Signed in asdev-user (provider admin)');
    await user.click(within(about).getByRole('button', { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('an ended session', () => {
  const expired = () => new ServiceError(401, 'missing x-forwarded-access-token');

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows one alert with Log in again instead of each page failing, and still offers Log out', async () => {
    const service = new MockConsoleService();
    service.getUser = async () => {
      throw expired();
    };
    service.listClusters = async () => {
      throw expired();
    };
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/clusters']}>
        <App service={service} />
      </MemoryRouter>,
    );
    const alert = await screen.findByTestId('session-ended-alert');
    expect(alert).toHaveTextContent('Your session has ended');
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.getAllByTestId('session-ended-alert')).toHaveLength(1);
    expect(screen.queryByText('Error loading clusters')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'User menu: Not signed in' }));
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveAttribute('href', '/oauth2/sign_out');

    await user.click(within(alert).getByRole('button', { name: 'Log in again' }));
    expect(reload).toHaveBeenCalled();
  });

  it('keeps a loaded page when a later call answers 401, and adds the alert', async () => {
    const service = new MockConsoleService();
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/clusters']}>
        <App service={service} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('row', { name: /^site1 / })).toBeInTheDocument();
    service.listClusters = async () => {
      throw expired();
    };
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByTestId('session-ended-alert')).toBeVisible();
    expect(screen.getByRole('row', { name: /^site1 / })).toBeInTheDocument();
    expect(screen.queryByText('Error loading clusters')).not.toBeInTheDocument();
    expect(screen.getByTestId('masthead-user')).toHaveTextContent('dev-user');
  });
});
