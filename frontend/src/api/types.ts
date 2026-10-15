// Response shapes of the BFF. Keep in sync with docs/plan/bff-api.md.

export type User = {
  username: string;
  email?: string;
  groups: string[];
  /** UI hint only; the backend enforces authorization. */
  isProviderAdmin: boolean;
};

export type ConsoleConfig = {
  gridEndpoint: string;
  mapTileUrl: string;
  billingUrl: string;
  version: string;
};

export type GridCluster = {
  name: string;
  aiGridEnabled: boolean;
  provisioned: boolean;
  hubAcceptsClient: boolean;
  location?: string;
  site?: string;
  region?: string;
  openshiftVersion?: string;
  labels: Record<string, string>;
};

export type Tenant = {
  id: string;
  name: string;
  domains: string[];
};
