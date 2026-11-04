import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IdentityProvider } from '../../api/types';
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
