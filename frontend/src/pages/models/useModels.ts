// The Models pages' calls to the backend's Models API over Connect (ai_grid.v1.Models, through the
// BFF's relay), and Subscriptions/List for the subscriptions that use a model. Reads poll as the
// Clusters pages do (useClusters.ts); writes are sent from the app root (useBackgroundWrites), which
// refetches every Models query once they land.
import { useMemo } from 'react';
import { callUnaryMethod, useQuery, useTransport } from '@connectrpc/connect-query';
import { toServiceError } from '../../api/connect/errors';
import { useBackgroundWrites, type WriteOutcome } from '../../notifications/useBackgroundWrites';
import { sentModelFields } from '../../notifications/writeFields';
import {
  type ModelsGetResponse,
  type ModelsListPlacementClustersResponse,
  type ModelsListResponse,
} from '../../gen/ai_grid/v1/models_service_pb';
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
import type { SubscriptionsListResponse } from '../../gen/ai_grid/v1/subscriptions_service_pb';
import { useLoadOptions, useLoaded, type Loaded } from '../clusters/useClusters';
import { createRequestOf, updateRequestOf, type ModelInput } from './modelRequests';
import { titleOf, toModelView, type ModelView } from './modelView';

const modelViews = (answer: ModelsListResponse | undefined) => answer?.items.map(toModelView) ?? [];
const modelView = (answer: ModelsGetResponse | undefined) => answer?.object && toModelView(answer.object);
const clusterNames = (answer: ModelsListPlacementClustersResponse | undefined) => answer?.clusters ?? [];
const subscriptionItems = (answer: SubscriptionsListResponse | undefined) => answer?.items ?? [];

/** Every model, from Models/List. */
export const useModelList = (): Loaded<ModelView[]> => useLoaded(useQuery(list, {}, useLoadOptions()), modelViews);

/**
 * One model from Models/Get. `poll: false` loads it once, as the edit page does, so the wizard starts
 * from the version the user saw.
 */
export const useModel = (id: string, { poll = true }: { poll?: boolean } = {}): Loaded<ModelView | undefined> => {
  const options = useLoadOptions();
  // The edit page passes poll: false on purpose: its wizard holds the snapshot it started from
  // (ModelEditPage), and a save is checked against that version.
  return useLoaded(useQuery(get, { id }, poll ? options : { retry: false, refetchInterval: false }), modelView);
};

/**
 * The clusters a model can be placed on, from Models/ListPlacementClusters: loaded when the wizard
 * opens and again on `refresh`, not polled.
 */
export const usePlacementClusters = (): Loaded<string[]> =>
  useLoaded(useQuery(listPlacementClusters, {}, { retry: false }), clusterNames);

/** What the wizard and the delete dialog write, and how the dialog loads a model again. */
export type ModelWrites = {
  /** `pending` when the write outlasted the form's wait and the notification center follows it. */
  createModel: (input: ModelInput) => Promise<WriteOutcome>;
  /** Sends the changed fields with `lock`; resolves to false when nothing changed. */
  updateModel: (model: ModelView, input: ModelInput) => Promise<WriteOutcome | false>;
  deleteModel: (model: ModelView) => Promise<WriteOutcome>;
  loadModel: (id: string) => Promise<ModelView | undefined>;
};

/**
 * Models/Create, Update and Delete, sent from the app root (useBackgroundWrites): a write that
 * outlasts the form's short wait keeps running when the form leaves, and the notification center
 * reports how it ended. The center refetches every Models query once a write lands. A failure that
 * comes back within the wait is the ServiceError the pages already show (toServiceError): Aborted,
 * a stale version, is a conflict; InvalidArgument the backend's message.
 */
export const useModelWrites = (): ModelWrites => {
  const transport = useTransport();
  const { submitWrite } = useBackgroundWrites();
  return useMemo(() => {
    const call = async <T>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        throw toServiceError(err);
      }
    };
    return {
      createModel: (input) => {
        const request = createRequestOf(input);
        return call(() =>
          submitWrite(
            {
              subject: 'model',
              op: 'create',
              id: input.name,
              name: input.displayName.trim() || input.name,
              // What a lost answer's read-back must find to confirm this deploy.
              expected: sentModelFields(request.object),
            },
            () => callUnaryMethod(transport, create, request),
          ),
        );
      },
      updateModel: async (model, input) => {
        const request = updateRequestOf(model, input);
        if (!request) return false;
        return call(() =>
          submitWrite(
            {
              subject: 'model',
              op: 'update',
              id: model.id,
              name: input.displayName.trim() || model.id,
              version: model.version,
              expected: sentModelFields(request.object, request.updateMask?.paths),
            },
            () => callUnaryMethod(transport, update, request),
          ),
        );
      },
      deleteModel: (model) =>
        call(() =>
          submitWrite({ subject: 'model', op: 'delete', id: model.id, name: titleOf(model) }, () =>
            // The version the user confirmed: a stale one is Aborted (ModelsDeleteRequest.resource_version).
            callUnaryMethod(transport, delete$, { id: model.id, resourceVersion: model.version }),
          ),
        ),
      loadModel: async (id) => {
        const { object } = await call(() => callUnaryMethod(transport, get, { id }));
        return object && toModelView(object);
      },
    };
  }, [transport, submitWrite]);
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
export const useSubscriptionsUsingModel = (id: string): Loaded<Subscription[]> =>
  useLoaded(useQuery(listSubscriptions, { filter: usingModelFilter(id) }, { retry: false }), subscriptionItems);
