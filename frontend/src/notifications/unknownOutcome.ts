import { Code, ConnectError } from '@connectrpc/connect';
import { ServiceError } from '../api/ConsoleService';

/**
 * The Connect codes after which nobody knows whether a write landed: the call was cut on the way
 * (DeadlineExceeded: the BFF's 504 or the backend's own deadline), the backend or a proxy in front
 * of it could not be reached or answered without the backend (Unavailable: the relay's 502, a
 * router's 502, 503 or 504), or the browser stopped waiting (Canceled: an aborted fetch).
 */
const unknownCodes = new Set<Code>([Code.DeadlineExceeded, Code.Unavailable, Code.Canceled]);

/** The statuses of the BFF's JSON API that say the same (toServiceError maps the codes to them). */
const unknownStatuses = new Set<number>([
  0, // the browser never got an answer (HttpConsoleService)
  503,
  504,
]);

/** A failed fetch: the request may or may not have reached the server. */
const isNetworkFailure = (err: unknown) =>
  err instanceof TypeError || (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));

/**
 * Whether a failed write's outcome is unknown: the backend may still have done it. Anything else
 * (a 4xx, or a 5xx the backend answered itself, such as Internal) is a definite failure the form
 * shows as today.
 */
export const isUnknownOutcome = (err: unknown): boolean => {
  if (err instanceof ServiceError) {
    return unknownStatuses.has(err.status);
  }
  if (err instanceof ConnectError) {
    // connect-web turns a fetch that failed (a TypeError) into Unknown, keeping it as the cause.
    return unknownCodes.has(err.code) || (err.code === Code.Unknown && isNetworkFailure(err.cause));
  }
  return isNetworkFailure(err);
};
