import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IdentityProvider } from './organizationView';
import { IdentityProviderFields } from './IdentityProviderFields';

const blank: IdentityProvider = {
  title: '',
  description: '',
  enabled: true,
  config: {
    clientId: '',
    clientSecretSecret: { name: '' },
    issuer: '',
    authorizationUrl: '',
    tokenUrl: '',
    defaultScopes: '',
    userInfoUrl: '',
    jwksUrl: '',
    logoutUrl: '',
    validateSignature: true,
  },
};

const Form = () => {
  const [value, setValue] = useState(blank);
  return <IdentityProviderFields value={value} onChange={setValue} />;
};

it('requires the JWKS URL only while Validate signature is on', async () => {
  const user = userEvent.setup();
  render(<Form />);
  const jwks = screen.getByRole('textbox', { name: /JWKS URL/ });
  expect(jwks).toBeRequired();

  await user.click(jwks);
  await user.tab();
  expect(screen.getByText('Enter the JWKS URL, or turn off Validate signature.')).toBeInTheDocument();

  await user.click(screen.getByRole('checkbox', { name: 'Validate signature' }));
  expect(jwks).not.toBeRequired();
  expect(screen.queryByText('Enter the JWKS URL, or turn off Validate signature.')).not.toBeInTheDocument();
});

it('requires the JWKS URL again when Validate signature is turned back on', async () => {
  const user = userEvent.setup();
  render(<Form />);
  const jwks = screen.getByRole('textbox', { name: /JWKS URL/ });
  const validate = screen.getByRole('checkbox', { name: 'Validate signature' });
  await user.click(jwks);
  await user.tab();

  await user.click(validate);
  expect(jwks).not.toBeRequired();
  expect(screen.queryByText('Enter the JWKS URL, or turn off Validate signature.')).not.toBeInTheDocument();

  await user.click(validate);
  expect(validate).toBeChecked();
  expect(jwks).toBeRequired();
  expect(screen.getByText('Enter the JWKS URL, or turn off Validate signature.')).toBeInTheDocument();
});
