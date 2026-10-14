import type { ConsoleService } from './ConsoleService';
import { ServiceError } from './ConsoleService';
import type { ClusterUpdate, ConsoleConfig, GridCluster, User } from './types';

/** In-memory service for tests and UI work without a cluster. */
export class MockConsoleService implements ConsoleService {
  constructor(
    public user: User = { username: 'dev-user', groups: ['cluster-admins'], isProviderAdmin: true },
    public clusters: GridCluster[] = seedClusters(),
    public config: ConsoleConfig = {
      hubNamespace: 'ai-grid',
      gridEndpoint: 'https://ai.grid.example.com',
      mapTileUrl: '',
      billingUrl: '',
      version: 'mock',
    },
  ) {}

  getUser = async (): Promise<User> => this.user;

  getConfig = async (): Promise<ConsoleConfig> => this.config;

  listClusters = async (): Promise<GridCluster[]> => [...this.clusters];

  updateCluster = async (name: string, update: ClusterUpdate): Promise<GridCluster> => {
    const index = this.clusters.findIndex((c) => c.name === name);
    if (index < 0) {
      throw new ServiceError(404, `managedclusters "${name}" not found`);
    }
    const current = this.clusters[index];
    const aiGridEnabled = update.aiGridEnabled ?? current.aiGridEnabled;
    const location = update.location === undefined ? current.location : update.location || undefined;
    const next: GridCluster = {
      ...current,
      aiGridEnabled,
      location,
      provisioningStatus: current.provisioned ? 'Provisioned' : aiGridEnabled ? 'Provisioning' : 'Not provisioned',
      resourceVersion: String(Number(current.resourceVersion) + 1),
    };
    this.clusters[index] = next;
    return next;
  };

  listLocations = async (): Promise<string[]> =>
    [...new Set(this.clusters.filter((c) => c.status === 'Ready' && c.aiGridEnabled && c.provisioned && c.location).map((c) => c.location as string))].sort();
}

export const seedClusters = (): GridCluster[] => [
  {
    name: 'local-cluster',
    status: 'Ready',
    aiGridEnabled: false,
    provisioned: false,
    provisioningStatus: 'Not provisioned',
    openshiftVersion: '4.22.15',
    consoleUrl: 'https://console.local.example.com',
    resourceVersion: '1',
  },
  {
    name: 'site-1',
    status: 'Ready',
    aiGridEnabled: true,
    provisioned: true,
    provisioningStatus: 'Provisioned',
    location: 'us-east-1',
    openshiftVersion: '4.22.15',
    resourceVersion: '1',
  },
  {
    name: 'site-2',
    status: 'Offline',
    aiGridEnabled: true,
    provisioned: false,
    provisioningStatus: 'Provisioning',
    location: 'eu-west-1',
    openshiftVersion: '4.22.15',
    resourceVersion: '1',
  },
];
