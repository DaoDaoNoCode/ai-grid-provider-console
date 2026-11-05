import type { DashboardResource } from '@perses-dev/client';
import type { ConsoleService } from './ConsoleService';
import { RelayedError, ServiceError } from './ConsoleService';
import { PERSES_API } from './monitoring';
import type { ConsoleConfig, User } from './types';

const API_PREFIX = '/api/v1';

type Envelope<T> = { data: T };
type ErrorBody = { error?: { code?: string; message?: string; fieldErrors?: Record<string, string> } };

export class HttpConsoleService implements ConsoleService {
  constructor(private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  getUser(): Promise<User> {
    return this.request<User>('GET', '/user');
  }

  getConfig(): Promise<ConsoleConfig> {
    return this.request<ConsoleConfig>('GET', '/config');
  }

  /**
   * GET /perses/api/api/v1/[projects/<project>/]dashboards through the BFF's relay. The relay passes
   * Perses's answers on unchanged, so a failure carries Perses's message, or the BFF's own for the
   * relay's checks (401, 403, 404 when monitoring isn't configured).
   */
  async listMonitoringDashboards(project: string): Promise<DashboardResource[]> {
    let response: Response;
    try {
      response = await this.fetchFn(`${PERSES_API}/api/v1/projects/${encodeURIComponent(project)}/dashboards`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      throw new ServiceError(0, 'Unable to reach the console server.');
    }
    if (!response.ok) {
      let message = `Request failed with status ${response.status}.`;
      try {
        const payload = (await response.json()) as ErrorBody & { message?: string };
        message = payload.error?.message || payload.message || message;
      } catch {
        // keep the generic message
      }
      throw new RelayedError(response.status, message);
    }
    return (await response.json()) as DashboardResource[];
  }

  /**
   * Calls the BFF and unwraps its data envelope; `undefined` for 204. The BFF's JSON API only
   * reads: every write goes to the backend over Connect (src/api/connect).
   */
  async request<T>(method: string, path: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${API_PREFIX}${path}`, {
        method,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
    } catch {
      throw new ServiceError(0, 'Unable to reach the console server.');
    }
    if (!response.ok) {
      let message = `Request failed with status ${response.status}.`;
      let fieldErrors: Record<string, string> | undefined;
      try {
        const payload = (await response.json()) as ErrorBody;
        if (payload.error?.message) {
          message = payload.error.message;
        }
        fieldErrors = payload.error?.fieldErrors;
      } catch {
        // keep the generic message
      }
      throw new ServiceError(response.status, message, fieldErrors);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const payload = (await response.json()) as Envelope<T>;
    return payload.data;
  }
}
