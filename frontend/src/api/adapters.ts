import type {
  ApiCluster,
  ApiTenant,
  ClusterState,
  ClusterStatus,
  GridCluster,
  IdentityProvider,
  Organization,
} from './types';

// The one place that turns the BFF's JSON into the types the pages read. It renames
// fields and picks display words; anything the backend should decide stays there.

const availability: Record<string, ClusterStatus> = { ready: 'Ready', offline: 'Offline' };

const states: Record<string, ClusterState> = {
  pendingimport: 'Pending import',
  importing: 'Importing',
  importfailed: 'Import failed',
  detaching: 'Detaching',
  notaccepted: 'Not accepted',
};

/**
 * Maps a cluster of GET /clusters, PATCH /clusters/{name}, or GET /grid/overview to the
 * PoC's GridCluster. Ready and offline keep their words; every other ACM state, and a
 * cluster without one, is Unknown, with the ACM word in `state`.
 */
export const toGridCluster = (json: ApiCluster): GridCluster => ({
  name: json.name,
  status: availability[json.status ?? ''] ?? 'Unknown',
  state: states[json.status ?? ''],
  statusMessage: json.statusMessage,
  aiGridEnabled: json.aiGridEnabled,
  provisioned: json.provisioned,
  // Membership first: right after Remove the hub can still report the cluster
  // provisioned until its ready Policy lets go of it.
  provisioningStatus: !json.aiGridEnabled ? 'Not provisioned' : json.provisioned ? 'Provisioned' : 'Provisioning',
  location: json.location,
  site: json.site,
  region: json.region,
  siteName: json.siteName,
  latitude: json.latitude,
  longitude: json.longitude,
  openshiftVersion: json.openshiftVersion,
  consoleUrl: json.consoleUrl,
  kubernetesVersion: json.kubernetesVersion,
  platform: json.platform,
  product: json.product,
  capacity: json.capacity,
  gpuCapacity: json.gpuCapacity,
  allocatable: json.allocatable,
  gpus: json.gpus,
  creationTimestamp: json.creationTimestamp,
  addons: json.addons ?? {},
  conditions: json.conditions ?? [],
  resourceVersion: json.resourceVersion,
  labels: json.labels ?? {},
});

const toIdentityProvider = (json: NonNullable<ApiTenant['identityProvider']>): IdentityProvider => {
  const config = json.config ?? {};
  return {
    title: json.title ?? '',
    description: json.description ?? '',
    // The backend refuses a disabled identity provider, as the PoC does.
    enabled: true,
    config: {
      clientId: config.clientId ?? '',
      clientSecretSecret: { name: config.clientSecretSecret?.name ?? '' },
      issuer: config.issuer ?? '',
      authorizationUrl: config.authorizationUrl ?? '',
      tokenUrl: config.tokenUrl ?? '',
      defaultScopes: config.defaultScopes ?? '',
      userInfoUrl: config.userInfoUrl ?? '',
      jwksUrl: config.jwksUrl ?? '',
      logoutUrl: config.logoutUrl ?? '',
      validateSignature: config.validateSignature ?? true,
    },
  };
};

/**
 * Maps a tenant of GET/POST/PATCH /tenants to the PoC's organization: "Enabled" or "Disabled" from
 * `enabled`, and the backend's version and creation time, empty when it sends none.
 */
export const toOrganization = (json: ApiTenant): Organization => {
  const out: Organization = {
    id: json.id,
    name: json.name,
    domains: json.domains ?? [],
    status: json.enabled ? 'Enabled' : 'Disabled',
    resourceVersion: json.resourceVersion ?? '',
    creationTimestamp: json.createTime ?? '',
  };
  if (json.description) {
    out.description = json.description;
  }
  if (json.attributes && Object.keys(json.attributes).length) {
    out.attributes = json.attributes;
  }
  if (json.domainDetails?.length) {
    out.domainDetails = json.domainDetails.map(({ name, verified }) => ({ name, verified }));
  }
  if (json.identityProvider) {
    out.identityProvider = toIdentityProvider(json.identityProvider);
  }
  return out;
};
