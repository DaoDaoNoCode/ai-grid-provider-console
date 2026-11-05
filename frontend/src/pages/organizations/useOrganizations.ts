// The Organizations pages' calls to the backend over Connect (docs/connect.md, "The Organizations
// area"): Tenants/List, Get, Create, Update and Delete. Tenants/ListMembers is never called: the
// provider doesn't see an organization's members, and the relay doesn't pass it.
import { useMemo } from 'react';
import { create } from '@bufbuild/protobuf';
import {
  callUnaryMethod,
  createConnectQueryKey,
  createQueryOptions,
  useQuery,
  useTransport,
} from '@connectrpc/connect-query';
import { skipToken, useQueryClient } from '@tanstack/react-query';
import {
  Tenants,
  TenantsGetResponseSchema,
  type TenantsGetResponse,
  type TenantsListResponse,
} from '../../gen/ai_grid/v1/tenants_service_pb';
import {
  create as createTenant,
  delete$ as remove,
  get,
  list,
  update,
} from '../../gen/ai_grid/v1/tenants_service-Tenants_connectquery';
import { useLoadOptions, useLoaded, type Loaded } from '../clusters/useClusters';
import { tenantOf, toOrganizationView, type OrganizationInput, type OrganizationView } from './organizationView';

const organizationViews = (answer: TenantsListResponse | undefined) => answer?.items.map(toOrganizationView) ?? [];
const organizationView = (answer: TenantsGetResponse | undefined) =>
  answer?.object && toOrganizationView(answer.object);

/**
 * Every organization from Tenants/List, polling as the other lists do. Off (`enabled` false), it
 * calls nothing and lists none.
 */
export const useOrganizationList = (enabled = true): Loaded<OrganizationView[]> =>
  useLoaded(useQuery(list, enabled ? {} : skipToken, useLoadOptions()), organizationViews);

/** One organization from Tenants/Get, loaded once, not polled; none without an id. */
export const useOrganization = (id: string | undefined): Loaded<OrganizationView | undefined> =>
  useLoaded(
    useQuery(get, id === undefined ? skipToken : { id }, { retry: false, refetchInterval: false }),
    organizationView,
  );

/**
 * The organization a write answered with; the backend always answers one, so none is a failure
 * the user can only resolve by reloading.
 */
const answered = (object: Parameters<typeof toOrganizationView>[0] | undefined): OrganizationView => {
  if (!object) throw new Error('The AI Grid backend did not return the organization. Refresh the page and try again.');
  return toOrganizationView(object);
};

/**
 * Tenants/Create, Update and Delete, and Get for a dialog that loads one again. A write that lands
 * drops the Organizations answers no page shows and marks the others stale, so a page opened next
 * loads the organizations as they are now rather than showing what was read before the write; an
 * update also keeps its answer as the organization's Get, which the page it returns to shows. A
 * page on screen reloads itself (`refresh`), so a deleted organization's page isn't asked for it
 * again before it leaves. A failure is the ConnectError (describeError says what to show).
 */
export const useOrganizationWrites = () => {
  const transport = useTransport();
  const queryClient = useQueryClient();
  return useMemo(() => {
    const landed = () => {
      const queryKey = createConnectQueryKey({ schema: Tenants, cardinality: undefined });
      queryClient.removeQueries({ queryKey, type: 'inactive' });
      void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
    };
    return {
      /** The name, the domains and the identity provider, when the form has one. */
      createOrganization: async (input: OrganizationInput): Promise<OrganizationView> => {
        const { object } = await callUnaryMethod(transport, createTenant, { object: tenantOf(input) });
        landed();
        return answered(object);
      },
      /**
       * The domains only (mask `spec.domains`), at the version the form read: the name is fixed
       * once created and the identity provider can't change after create, so neither is sent.
       */
      updateOrganization: async (organization: OrganizationView, domains: string[]): Promise<OrganizationView> => {
        const { object } = await callUnaryMethod(transport, update, {
          object: { id: organization.id, metadata: { version: organization.version }, spec: { domains } },
          updateMask: { paths: ['spec.domains'] },
          lock: true,
        });
        const saved = answered(object);
        landed();
        queryClient.setQueryData(
          createQueryOptions(get, { id: organization.id }, { transport }).queryKey,
          create(TenantsGetResponseSchema, { object }),
        );
        return saved;
      },
      /** At the version the dialog read: one someone else changed since is Aborted. */
      deleteOrganization: async (organization: OrganizationView): Promise<void> => {
        await callUnaryMethod(transport, remove, { id: organization.id, version: organization.version });
        landed();
      },
      /** The organization as the backend has it now. */
      loadOrganization: async (id: string): Promise<OrganizationView> =>
        answered((await callUnaryMethod(transport, get, { id })).object),
    };
  }, [transport, queryClient]);
};
