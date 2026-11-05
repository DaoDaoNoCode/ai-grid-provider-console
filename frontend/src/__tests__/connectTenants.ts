// The backend's Tenants API for page tests, in the generated messages (fakeClients serializes them as
// JSON): List, Get, Create, Update and Delete over an in-memory list, with the rules the pages show,
// as the backend's internal/servers/tenants_server.go and identity_provider.go answer at
// .backend-api-version: versions from 1, bumped on every write; a version required on Update and
// Delete (InvalidArgument without one) and Aborted when stale; AlreadyExists for a taken name or
// domain; NotFound; an identity provider set only on Create, normalized (an empty title is the
// name, the default scopes "openid profile email", enabled and validate_signature true), and
// refused on an Update that adds, changes or removes it. The backend sends no field violations;
// a test that needs them throws its own from `before`.
import { clone, create, type MessageInitShape } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { Code, ConnectError } from '@connectrpc/connect';
import type { FakeBackend } from '../api/connect/testing';
import { BadRequestSchema } from '../gen/google/rpc/error_details_pb';
import {
  IdentityProviderSchema,
  TenantSchema,
  type IdentityProvider,
  type Tenant,
} from '../gen/ai_grid/v1/tenant_type_pb';

type Impl = Required<Pick<NonNullable<FakeBackend['tenants']>, 'list' | 'get' | 'create' | 'update' | 'delete'>>;
type Method = keyof Impl;

/** The fixture organization acme-robotics, with every identity provider field set. */
export const ACME_ID = '3f1c9a72-5b6e-4d2a-8c01-2d3e4f5a6b7c';
/** The fixture organization globex-research. */
export const GLOBEX_ID = '8d2e7b31-0c4f-4a9d-b5e6-7f8a9b0c1d2e';
/** The fixture organization initech-labs, which has no domains. */
export const INITECH_ID = 'c5a4d3e2-f1b0-4987-a6c5-d4e3f2a1b0c9';

/** A tenant as the backend answers it; the fields a test leaves out are the backend's defaults. */
export const tenantObject = (init: MessageInitShape<typeof TenantSchema>): Tenant => create(TenantSchema, init);

/**
 * The PoC's three organizations (the backend's fixtures/poc/organizations.json), each with an OIDC
 * identity provider as the backend stores one: acme-robotics with every field, globex-research
 * without a user info or logout URL, initech-labs without domains and with an empty title, which
 * the backend stores as the name.
 */
export const seedTenants = (): Tenant[] =>
  (
    [
      [ACME_ID, 'acme-robotics', ['acme-robotics.example.com', 'acme.example.org'], 'Acme Robotics SSO', '2026-09-01'],
      [GLOBEX_ID, 'globex-research', ['globex.example.com'], 'Globex SSO', '2026-09-02'],
      [INITECH_ID, 'initech-labs', [], '', '2026-09-03'],
    ] as [string, string, string[], string, string][]
  ).map(([id, name, domains, title, created]) => {
    const realm = `https://sso.example.com/realms/${name}`;
    const oidc = `${realm}/protocol/openid-connect`;
    const full = name === 'acme-robotics';
    return tenantObject({
      id,
      metadata: { name, version: 1, creationTimestamp: timestampFromDate(new Date(`${created}T09:00:00Z`)) },
      spec: {
        domains,
        identityProvider: {
          title: title || name,
          description: full ? 'Employees of Acme Robotics sign in here.' : '',
          enabled: true,
          config: {
            clientId: 'ai-grid',
            clientSecretSecretName: `${name}-oidc-client`,
            issuer: realm,
            authorizationUrl: `${oidc}/auth`,
            tokenUrl: `${oidc}/token`,
            defaultScopes: 'openid profile email',
            userInfoUrl: full ? `${oidc}/userinfo` : '',
            jwksUrl: `${oidc}/certs`,
            logoutUrl: full ? `${oidc}/logout` : '',
            validateSignature: true,
          },
        },
      },
      status: {},
    });
  });

/** InvalidArgument with a google.rpc.BadRequest detail, field to description. */
export const fieldViolations = (message: string, fields: Record<string, string>) =>
  new ConnectError(message, Code.InvalidArgument, undefined, [
    {
      desc: BadRequestSchema,
      value: { fieldViolations: Object.entries(fields).map(([field, description]) => ({ field, description })) },
    },
  ]);

/** The identity provider as the backend stores it (normalizeIdentityProvider). */
const normalized = (name: string, idp: IdentityProvider): IdentityProvider => {
  const out = clone(IdentityProviderSchema, idp);
  if (out.enabled === false) {
    throw new ConnectError('spec.identity_provider.enabled must be true', Code.InvalidArgument);
  }
  out.title = out.title.trim() || name;
  out.enabled = true;
  if (!out.config) throw new ConnectError('spec.identity_provider.config is required', Code.InvalidArgument);
  out.config.defaultScopes = out.config.defaultScopes.trim() || 'openid profile email';
  out.config.validateSignature ??= true;
  return out;
};

/** The update_mask paths the backend accepts (tenantUpdatePaths), with what each writes. */
const maskPaths = (paths: string[]) => {
  let domains = false;
  let idp = false;
  let name = false;
  for (const path of paths) {
    switch (path.replace(/^object\./, '')) {
      case 'id':
      case 'metadata.version':
      case 'metadata.creation_timestamp':
        break;
      case 'metadata':
      case 'metadata.name':
        name = true;
        break;
      case 'spec':
        domains = true;
        idp = true;
        break;
      case 'spec.domains':
        domains = true;
        break;
      case 'spec.identity_provider':
        idp = true;
        break;
      default:
        throw new ConnectError(`unsupported update_mask path "${path}"`, Code.InvalidArgument);
    }
  }
  return { name, domains, idp };
};

/** The in-memory tenants. */
export class FakeTenants {
  tenants: Tenant[] = seedTenants();

  /**
   * Runs before each method, so a test can make one fail (throw), wait (return a promise) or count
   * its calls; requests are recorded in `requests`.
   */
  before: Partial<Record<Method, (request: unknown) => unknown>> = {};
  requests: { method: Method; request: unknown }[] = [];

  /** The requests of one method, as the backend received them. */
  sent<M extends Method>(method: M): Parameters<Impl[M]>[0][] {
    return this.requests.filter((r) => r.method === method).map((r) => r.request as Parameters<Impl[M]>[0]);
  }

  /** The tenant with this id, as stored. */
  find(id: string): Tenant | undefined {
    return this.tenants.find((t) => t.id === id);
  }

  /** Someone else's write: the stored tenant's version moves on. */
  bump(id: string): void {
    const stored = this.find(id);
    if (stored?.metadata) stored.metadata.version += 1;
  }

  private async enter(method: Method, request: unknown) {
    this.requests.push({ method, request });
    await this.before[method]?.(request);
  }

  private stored(id: string): Tenant {
    if (!id.trim()) throw new ConnectError('id is required', Code.InvalidArgument);
    const found = this.find(id);
    if (!found) throw new ConnectError(`tenant "${id}" not found`, Code.NotFound);
    return found;
  }

  /** A name or domain another tenant has: Keycloak's 409, AlreadyExists. */
  private taken(self: string | undefined, name: string, domains: string[]) {
    return this.tenants.some(
      (t) => t.id !== self && (t.metadata?.name === name || t.spec?.domains.some((d) => domains.includes(d))),
    );
  }

  backend(): Impl {
    return {
      list: async (request) => {
        await this.enter('list', request);
        const items = [...this.tenants].sort((a, b) => (a.metadata?.name ?? '').localeCompare(b.metadata?.name ?? ''));
        return { items, size: items.length, total: items.length };
      },
      get: async (request) => {
        await this.enter('get', request);
        return { object: this.stored(request.id) };
      },
      create: async (request) => {
        await this.enter('create', request);
        const object = request.object;
        if (!object) throw new ConnectError('object is required', Code.InvalidArgument);
        const name = object.metadata?.name ?? '';
        if (!name) throw new ConnectError('metadata.name is required', Code.InvalidArgument);
        if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) || name.length > 63) {
          throw new ConnectError(`metadata.name "${name}" is not a valid RFC 1123 DNS label`, Code.InvalidArgument);
        }
        const domains = (object.spec?.domains ?? []).map((d) => d.trim());
        const idp = object.spec?.identityProvider && normalized(name, object.spec.identityProvider);
        if (this.taken(undefined, name, domains)) {
          throw new ConnectError(`tenant "${name}" already exists`, Code.AlreadyExists);
        }
        const created = tenantObject({
          id: crypto.randomUUID(),
          metadata: { name, version: 1, creationTimestamp: timestampFromDate(new Date()) },
          spec: { domains, ...(idp ? { identityProvider: idp } : {}) },
          status: {},
        });
        this.tenants.push(created);
        return { object: created };
      },
      update: async (request) => {
        await this.enter('update', request);
        const { object, updateMask } = request;
        if (!object) throw new ConnectError('object is required', Code.InvalidArgument);
        const version = object.metadata?.version ?? 0;
        if (!version) {
          throw new ConnectError(
            "a version is required: send the organization's metadata.version",
            Code.InvalidArgument,
          );
        }
        const stored = this.stored(object.id);
        if (version !== stored.metadata?.version) {
          throw new ConnectError(
            `update tenant "${object.id}": the tenant changed since it was read; reload and retry`,
            Code.Aborted,
          );
        }
        const paths = maskPaths(updateMask?.paths ?? []);
        if (paths.idp) {
          const sent = object.spec?.identityProvider;
          const kept = stored.spec?.identityProvider;
          if (!kept && sent) {
            throw new ConnectError('spec.identity_provider cannot be added after create', Code.InvalidArgument);
          }
          if (kept && !sent) throw new ConnectError('spec.identity_provider cannot be removed', Code.InvalidArgument);
        }
        const next = clone(TenantSchema, stored);
        if (paths.name && object.metadata?.name && next.metadata) next.metadata.name = object.metadata.name;
        if (paths.domains && next.spec) next.spec.domains = (object.spec?.domains ?? []).map((d) => d.trim());
        if (paths.name || paths.domains) {
          if (this.taken(object.id, next.metadata?.name ?? '', next.spec?.domains ?? [])) {
            throw new ConnectError(
              `update tenant "${object.id}": the name or a domain is already used by another organization`,
              Code.AlreadyExists,
            );
          }
          if (next.metadata) next.metadata.version += 1;
          this.tenants = this.tenants.map((t) => (t.id === next.id ? next : t));
        }
        return { object: next };
      },
      delete: async (request) => {
        await this.enter('delete', request);
        const { id, version } = request;
        if (!version) {
          throw new ConnectError(
            "a version is required: send the organization's metadata.version",
            Code.InvalidArgument,
          );
        }
        const stored = this.stored(id);
        if (version !== stored.metadata?.version) {
          throw new ConnectError(
            `delete tenant "${id}": the tenant changed since it was read; reload and retry`,
            Code.Aborted,
          );
        }
        this.tenants = this.tenants.filter((t) => t.id !== id);
        return {};
      },
    };
  }
}

/** The fakes of every service: one per test's service object, so a test can change them. */
const fakes = new WeakMap<object, FakeTenants>();

/** The tenants a test's service answers over Connect, seeded with the PoC's organizations. */
export const tenantsOf = (service: object): FakeTenants => {
  let fake = fakes.get(service);
  if (!fake) {
    fake = new FakeTenants();
    fakes.set(service, fake);
  }
  return fake;
};
