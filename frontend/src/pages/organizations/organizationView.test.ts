import { create, type MessageInitShape } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { TenantSchema, type Tenant } from '../../gen/ai_grid/v1/tenant_type_pb';
import { formPathOf, tenantOf, toOrganizationView, type IdentityProvider } from './organizationView';

const config = {
  clientId: 'ai-grid',
  issuer: 'https://sso.example.com/realms/acme-robotics',
  authorizationUrl: 'https://sso.example.com/realms/acme-robotics/auth',
  tokenUrl: 'https://sso.example.com/realms/acme-robotics/token',
  defaultScopes: 'openid profile email',
  userInfoUrl: '',
  jwksUrl: '',
  logoutUrl: '',
};

/** acme-robotics as Tenants/Get answers it. */
const tenant = (init: Omit<MessageInitShape<typeof TenantSchema>, '$typeName'> = {}): Tenant =>
  create(TenantSchema, {
    id: '3f1c9a72-5b6e-4d2a-8c01-2d3e4f5a6b7c',
    metadata: {
      name: 'acme-robotics',
      version: 3,
      creationTimestamp: timestampFromDate(new Date('2026-09-01T09:00:00Z')),
    },
    spec: {
      domains: ['acme-robotics.example.com', 'acme.example.org'],
      identityProvider: {
        title: 'Acme Robotics SSO',
        description: '',
        enabled: true,
        config: { ...config, clientSecretSecretName: 'acme-robotics-oidc-client', validateSignature: false },
      },
    },
    status: {},
    ...init,
  });

const identityProvider: IdentityProvider = {
  title: 'Acme Robotics SSO',
  description: '',
  enabled: true,
  config: { ...config, clientSecretSecret: { name: 'acme-robotics-oidc-client' }, validateSignature: false },
};

describe('toOrganizationView', () => {
  it('maps a tenant to an organization', () => {
    expect(toOrganizationView(tenant())).toEqual({
      id: '3f1c9a72-5b6e-4d2a-8c01-2d3e4f5a6b7c',
      name: 'acme-robotics',
      domains: ['acme-robotics.example.com', 'acme.example.org'],
      version: 3,
      creationTimestamp: '2026-09-01T09:00:00.000Z',
      identityProvider,
    });
  });

  it('has no identity provider when the tenant has none', () => {
    const organization = toOrganizationView(tenant({ spec: { domains: [] } }));
    expect(organization.identityProvider).toBeUndefined();
    expect(organization.domains).toEqual([]);
  });

  it('reads omitted identity provider booleans as true', () => {
    const organization = toOrganizationView(
      tenant({ spec: { domains: [], identityProvider: { title: 'SSO', config: { clientId: 'ai-grid' } } } }),
    );
    expect(organization.identityProvider?.enabled).toBe(true);
    expect(organization.identityProvider?.config.validateSignature).toBe(true);
  });

  it('has no creation time for an organization created outside the backend', () => {
    // The pages print a dash without one.
    const organization = toOrganizationView(tenant({ metadata: { name: 'acme-robotics', version: 1 } }));
    expect(organization).not.toHaveProperty('creationTimestamp');
  });

  it('names an organization without a name by its id', () => {
    expect(toOrganizationView(tenant({ metadata: { name: '', version: 1 } })).name).toBe(
      '3f1c9a72-5b6e-4d2a-8c01-2d3e4f5a6b7c',
    );
  });
});

describe('tenantOf', () => {
  it('sends the name, the domains and the identity provider as the backend names them', () => {
    expect(tenantOf({ name: 'acme-robotics', domains: ['acme.example.org'], identityProvider })).toEqual({
      metadata: { name: 'acme-robotics' },
      spec: {
        domains: ['acme.example.org'],
        identityProvider: {
          title: 'Acme Robotics SSO',
          description: '',
          enabled: true,
          config: { ...config, clientSecretSecretName: 'acme-robotics-oidc-client', validateSignature: false },
        },
      },
    });
  });

  it('sends no identity provider without one', () => {
    expect(tenantOf({ name: 'initech-labs', domains: [] })).toEqual({
      metadata: { name: 'initech-labs' },
      spec: { domains: [] },
    });
  });
});

describe('formPathOf', () => {
  it.each([
    ['metadata.name', 'name'],
    ['object.metadata.name', 'name'],
    ['spec.domains', 'domains'],
    ['spec.domains[1]', 'domains.1'],
    ['spec.domains.0', 'domains.0'],
    ['spec.identity_provider', 'identityProvider'],
    ['spec.identity_provider.title', 'identityProvider.title'],
    ['spec.identity_provider.config.issuer', 'identityProvider.config.issuer'],
    ['spec.identity_provider.config.client_id', 'identityProvider.config.clientId'],
    ['spec.identity_provider.config.client_secret_secret_name', 'identityProvider.config.clientSecretSecret.name'],
    ['spec.identityProvider.config.clientSecretSecretName', 'identityProvider.config.clientSecretSecret.name'],
    ['spec.identity_provider.config.jwks_url', 'identityProvider.config.jwksUrl'],
    ['identityProvider.config.issuer', 'identityProvider.config.issuer'],
  ])('puts a violation of %s on the form field %s', (field, path) => {
    expect(formPathOf(field)).toBe(path);
  });
});
