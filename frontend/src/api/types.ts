// Response shapes of the BFF. Keep in sync with docs/plan/bff-api.md.

export type User = {
  username: string;
  groups: string[];
  isProviderAdmin: boolean;
};

export type ConsoleConfig = {
  hubNamespace: string;
  gridEndpoint: string;
  mapTileUrl: string;
  billingUrl: string;
  version: string;
};

export type ClusterStatus = 'Ready' | 'Offline' | 'Unknown';
export type ProvisioningStatus = 'Provisioned' | 'Provisioning' | 'Not provisioned';

export type GridCluster = {
  name: string;
  status: ClusterStatus;
  aiGridEnabled: boolean;
  provisioned: boolean;
  provisioningStatus: ProvisioningStatus;
  location?: string;
  consoleUrl?: string;
  openshiftVersion?: string;
  resourceVersion: string;
};

export type ClusterUpdate = {
  aiGridEnabled?: boolean;
  location?: string;
};
