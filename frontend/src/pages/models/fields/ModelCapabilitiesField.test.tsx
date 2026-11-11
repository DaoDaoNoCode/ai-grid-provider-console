import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelCapabilitiesField } from './ModelCapabilitiesField';

/** The field as the wizard holds it: the selection in state, starting from `initial`. */
const Field: React.FC<{ initial: string[] }> = ({ initial }) => {
  const [value, setValue] = useState(initial);
  return <ModelCapabilitiesField value={value} onChange={setValue} />;
};

const addButton = () => screen.getByRole('button', { name: 'Add capability' });

describe('ModelCapabilitiesField by keyboard', () => {
  it('says Add capability opens a menu, and whether it is open', async () => {
    const user = userEvent.setup();
    render(<Field initial={[]} />);
    expect(addButton()).toHaveAttribute('aria-haspopup', 'menu');
    expect(addButton()).toHaveAttribute('aria-expanded', 'false');
    addButton().focus();
    await user.keyboard('{Enter}');
    expect(addButton()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(addButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('adds the value selected with Enter, and focuses Add capability again', async () => {
    const user = userEvent.setup();
    render(<Field initial={[]} />);
    addButton().focus();
    await user.keyboard('{Enter}');
    screen.getByRole('menuitem', { name: 'Chat' }).focus();
    await user.keyboard('{Enter}');
    // Closed: the toggle says so (the menu itself leaves the page after Popper's exit transition).
    expect(addButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Remove Chat' })).toBeVisible();
    expect(addButton()).toHaveFocus();
  });

  it('focuses Add capability once a label is removed with Enter', async () => {
    const user = userEvent.setup();
    render(<Field initial={['Chat', 'Vision']} />);
    screen.getByRole('button', { name: 'Remove Chat' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Remove Chat' })).not.toBeInTheDocument();
    expect(addButton()).toHaveFocus();
  });

  it('focuses the last label once the last value left to add is selected, which takes Add capability away', async () => {
    const user = userEvent.setup();
    render(<Field initial={['Vision', 'Transcription', 'Chat']} />);
    addButton().focus();
    await user.keyboard('{Enter}');
    screen.getByRole('menuitem', { name: 'Text completion' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Add capability' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Text completion' })).toHaveFocus();
  });

  it('focuses the last label once one is removed while nothing is left to add', async () => {
    const user = userEvent.setup();
    render(<Field initial={['Vision', 'Transcription', 'Chat', 'Text completion', 'my-tag']} />);
    screen.getByRole('button', { name: 'Remove my-tag' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Add capability' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Text completion' })).toHaveFocus();
  });
});
