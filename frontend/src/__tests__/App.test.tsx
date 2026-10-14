import { render, screen, waitFor } from '@testing-library/react';
import { App } from '../App';
import { MockConsoleService } from '../api/MockConsoleService';

describe('App', () => {
  it('shows the signed-in user and the clusters from the service', async () => {
    const service = new MockConsoleService();
    render(<App service={service} />);

    await waitFor(() => expect(screen.getByTestId('masthead-user')).toHaveTextContent('dev-user (provider admin)'));
    expect(await screen.findByText('local-cluster')).toBeInTheDocument();
    expect(screen.getByText('site-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add local-cluster to AI Grid' })).toBeEnabled();
  });

  it('disables enrolment for users who are not provider admins', async () => {
    const service = new MockConsoleService({ username: 'viewer', groups: [], isProviderAdmin: false });
    render(<App service={service} />);

    expect(await screen.findByRole('button', { name: 'Add local-cluster to AI Grid' })).toBeDisabled();
  });
});
