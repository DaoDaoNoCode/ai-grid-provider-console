// The Models pages' calls to the backend's Models API over Connect (ai_grid.v1.Models, through the
// BFF's relay), and Subscriptions/List for the subscriptions that use a model. Reads poll as the
// Clusters pages do (useClusters.ts); writes go through useMutation and refetch every Models query
// once they land.
import { useCallback, useMemo } from 'react';
import { callUnaryMethod, createConnectQueryKey, useMutation, useQuery, useTransport } from '@connectrpc/connect-query';
import { useQueryClient } from '@tanstack/react-query';
import { toServiceError } from '../../api/connect/errors';
import { Models } from '../../gen/ai_grid/v1/models_service_pb';
import {
  create,
  delete$,
  get,
  list,
  listPlacementClusters,
  update,
} from '../../gen/ai_grid/v1/models_service-Models_connectquery';
import { list as listSubscriptions } from '../../gen/ai_grid/v1/subscriptions_service-Subscriptions_connectquery';
import type { Subscription } from '../../gen/ai_grid/v1/subscription_type_pb';
import { loadErrorOf, useLoadOptions, type Loaded } from '../clusters/useClusters';
import { createRequestOf, updateRequestOf, type ModelInput } from './modelRequests';
import { toModelView, type ModelView } from './modelView';

/** Every model, from Models/List. */
export const useModelList = (): Loaded<ModelView[]> => {
  const objects = useQuery(list, {}, useLoadOptions());
  const { refetch } = objects;
  const data = useMemo(() => objects.data?.items.map(toModelView) ?? [], [objects.data]);
  const refresh = useCallback(async () => (await refetch()).isSuccess, [refetch]);
  return {
    data,
    loaded: objects.isFetched,
    error: loadErrorOf(!!objects.data, objects.error),
    updatedAt: objects.data ? objects.dataUpdatedAt : undefined,
    refresh,
  };
};

/**
 * One model from Models/Get. `poll: false` loads it once, as the edit page does, so the wizard starts
 * from the version the user saw.
 */
export const useModel = (id: string, { poll = true }: { poll?: boolean } = {}): Loaded<ModelView | undefined> => {
  const options = useLoadOptions();
  const object = useQuery(get, { id }, poll ? options : { retry: false, refetchInterval: false });
  const { refetch } = object;
  const data = useMemo(() => object.data?.object && toModelView(object.data.object), [object.data]);
  const refresh = useCallback(async () => (await refetch()).isSuccess, [refetch]);
  return { data, loaded: object.isFetched, error: loadErrorOf(!!data, object.error), refresh };
};

/**
 * The clusters a model can be placed on, from Models/ListPlacementClusters: loaded when the wizard
 * opens and again on `refresh`, not polled.
 */
export const usePlacementClusters = (): Loaded<string[]> => {
  const answer = useQuery(listPlacementClusters, {}, { retry: false });
  const { refetch } = answer;
  const data = useMemo(() => answer.data?.clusters ?? [], [answer.data]);
  const refresh = useCallback(async () => (await refetch()).isSuccess, [refetch]);
  return { data, loaded: answer.isFetched, error: loadErrorOf(!!answer.data, answer.error), refresh };
};

/** What the wizard and the delete dialog write, and how the dialog loads a model again. */
export type ModelWrites = {
  createModel: (input: ModelInput) => Promise<void>;
  /** Sends the changed fields with `lock`; resolves to false when nothing changed. */
  updateModel: (model: ModelView, input: ModelInput) => Promise<boolean>;
  deleteModel: (model: ModelView) => Promise<void>;
  loadModel: (id: string) => Promise<ModelView | undefined>;
};

/**
 * Models/Create, Update and Delete. A failure is the ServiceError the pages already show
 * (toServiceError): Aborted, a stale version, is a conflict; InvalidArgument the backend's message.
 */
export const useModelWrites = (): ModelWrites => {
  const transport = useTransport();
  const queryClient = useQueryClient();
  const onSuccess = () =>
    queryClient.invalidateQueries({ queryKey: createConnectQueryKey({ schema: Models, cardinality: undefined }) });
  const creating = useMutation(create, { onSuccess });
  const updating = useMutation(update, { onSuccess });
  const deleting = useMutation(delete$, { onSuccess });
  const { mutateAsync: createAsync } = creating;
  const { mutateAsync: updateAsync } = updating;
  const { mutateAsync: deleteAsync } = deleting;
  return useMemo(() => {
    const call = async <T>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        throw toServiceError(err);
      }
    };
    return {
      createModel: async (input) => {
        await call(() => createAsync(createRequestOf(input)));
      },
      updateModel: async (model, input) => {
        const request = updateRequestOf(model, input);
        if (!request) return false;
        await call(() => updateAsync(request));
        return true;
      },
      deleteModel: async (model) => {
        // The version the user confirmed: a stale one is Aborted (ModelsDeleteRequest.resource_version).
        await call(() => deleteAsync({ id: model.id, resourceVersion: model.version }));
      },
      loadModel: async (id) => {
        const { object } = await call(() => callUnaryMethod(transport, get, { id }));
        return object && toModelView(object);
      },
    };
  }, [transport, createAsync, updateAsync, deleteAsync]);
};

/**
 * The CEL filter for the subscriptions with a model ref joined to this model: the backend sets
 * `model_id` on a ref that names the model's MaaSModelRef (SubscriptionModelRef.model_id), and
 * evaluates the filter after that join (subscriptions_server.go, List). Ids are DNS labels, so the
 * id needs no escaping; any other value matches nothing.
 */
export const usingModelFilter = (id: string) =>
  /^[a-z0-9-]+$/.test(id) ? `this.spec.model_refs.exists(r, r.model_id == "${id}")` : 'false';

/** The subscriptions that use the model, from Subscriptions/List; loaded once. */
export const useSubscriptionsUsingModel = (id: string): Loaded<Subscription[]> => {
  const answer = useQuery(listSubscriptions, { filter: usingModelFilter(id) }, { retry: false });
  const { refetch } = answer;
  const data = useMemo(() => answer.data?.items ?? [], [answer.data]);
  const refresh = useCallback(async () => (await refetch()).isSuccess, [refetch]);
  return { data, loaded: answer.isFetched, error: loadErrorOf(!!answer.data, answer.error), refresh };
};
