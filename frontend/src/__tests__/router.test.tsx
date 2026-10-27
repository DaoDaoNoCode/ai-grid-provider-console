import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { routerProps } from '../router';

const Page: React.FC = () => {
  const { search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate('/monitoring?start=6h')}>Last 6 hours</button>
      <p>{search || 'no range'}</p>
    </>
  );
};

describe('the console router', () => {
  // Outside act(), which would flush a transition's render as well, so the click is the browser's.
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  // As a React transition, a navigation renders later and in slices, where React 18 can lose a
  // class component's setState, such as the Perses time range menu's closing one (src/router.ts).
  it('renders a navigation in one go, within the click that caused it', async () => {
    render(
      <MemoryRouter initialEntries={['/monitoring']} {...routerProps}>
        <Page />
      </MemoryRouter>,
    );
    expect(await screen.findByText('no range')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Last 6 hours' }).click();
    // React renders a click's updates in the microtask it queues during the click; a transition
    // would wait for a later task of React's scheduler.
    await Promise.resolve();
    expect(screen.getByText('?start=6h')).toBeInTheDocument();
  });
});
