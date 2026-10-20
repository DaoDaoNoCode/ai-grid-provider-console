import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TypeaheadSelect } from '../components/TypeaheadSelect';

const OPTIONS = [
  { value: 'a', label: 'acme-robotics' },
  { value: 'g', label: 'globex-research' },
  { value: 'i', label: 'initech' },
];

const Harness = ({ onChange }: { onChange: (value: string) => void }) => {
  const [value, setValue] = useState('');
  return (
    <TypeaheadSelect
      id="org"
      aria-label="Organization"
      placeholder="Select an organization"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
};

it('draws a PatternFly menu, filters as you type and picks with the keyboard', async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<Harness onChange={onChange} />);
  const input = screen.getByRole('combobox', { name: 'Organization' });
  expect(input).toHaveAttribute('placeholder', 'Select an organization');

  await user.click(input);
  expect(screen.getAllByRole('option')).toHaveLength(3);
  await user.type(input, 'GLO');
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['globex-research']);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenLastCalledWith('g');
  expect(input).toHaveValue('globex-research');
  expect(input).toHaveAttribute('aria-expanded', 'false');

  // Typing and then leaving with Escape keeps the selection's label.
  await user.type(input, 'zz');
  expect(screen.getByRole('option', { name: 'No results found' })).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(input).toHaveValue('globex-research');
  expect(onChange).toHaveBeenCalledTimes(1);
});
