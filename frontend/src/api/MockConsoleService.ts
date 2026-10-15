import type { ConsoleService } from './ConsoleService';
import type { ConsoleConfig, GridCluster, Tenant, User } from './types';

/** In-memory service for tests and UI work without a cluster. */
export class MockConsoleService implements ConsoleService {
  constructor(
    public user: User = { username: 'dev-user', groups: ['cluster-admins'], isProviderAdmin: true },
    public clusters: GridCluster[] = seedClusters(),
    public tenants: Tenant[] = seedTenants(),
    public config: ConsoleConfig = {
      gridEndpoint: 'https://ai.grid.example.com',
      mapTileUrl: '',
      billingUrl: '',
      version: 'mock',
    },
  ) {}

  getUser = async (): Promise<User> => this.user;

  getConfig = async (): Promise<ConsoleConfig> => this.config;

  listClusters = async (): Promise<GridCluster[]> => [...this.clusters];

  listTenants = async (): Promise<Tenant[]> => [...this.tenants];
}

export const seedClusters = (): GridCluster[] => [
  {
    name: 'local-cluster',
    aiGridEnabled: false,
    provisioned: false,
    hubAcceptsClient: true,
    openshiftVersion: '4.22.15',
    labels: { 'local-cluster': 'true', openshiftVersion: '4.22.15' },
  },
  {
    name: 'site-1',
    aiGridEnabled: true,
    provisioned: true,
    hubAcceptsClient: true,
    location: 'brussels',
    site: 'brussels-dc1',
    region: 'europe-west',
    openshiftVersion: '4.22.15',
    labels: { 'ai-grid/enabled': 'true', 'ai-grid/provisioned': 'true', location: 'brussels' },
  },
  {
    name: 'site-2',
    aiGridEnabled: true,
    provisioned: false,
    hubAcceptsClient: false,
    location: 'new-york',
    site: 'nyc-dc2',
    region: 'us-east',
    labels: { 'ai-grid/enabled': 'true', location: 'new-york' },
  },
];

export const seedTenants = (): Tenant[] => [
  { id: 'a1', name: 'tenant-a', domains: ['a.example.com'] },
  { id: 'b2', name: 'tenant-b', domains: [] },
];
