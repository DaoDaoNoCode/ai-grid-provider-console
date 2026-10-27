import { Code, ConnectError, type Interceptor, type Transport } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

/**
 * Calls `checkSession` whenever a call fails with Unauthenticated, then lets the caller see the
 * error as before. The console's checkSession (App, through useConsoleSession) loads the user
 * again and ends the session only if that answers 401 too, as it does for the Monitoring relay.
 * A server stream can fail after its headers, so its messages are watched as well.
 */
export const sessionCheck =
  (checkSession: () => void): Interceptor =>
  (next) =>
  async (req) => {
    const notify = (err: unknown) => {
      if (ConnectError.from(err).code === Code.Unauthenticated) {
        checkSession();
      }
    };
    try {
      const res = await next(req);
      if (!res.stream) {
        return res;
      }
      const messages = res.message;
      return {
        ...res,
        message: (async function* () {
          try {
            yield* messages;
          } catch (err) {
            notify(err);
            throw err;
          }
        })(),
      };
    } catch (err) {
      notify(err);
      throw err;
    }
  };

export type ConsoleTransportOptions = {
  /** The console's session check (useConsoleSession().checkSession); without one, nothing is checked. */
  checkSession?: () => void;
  /** The console's origin by default: the BFF relays /ai_grid.v1.* to the backend (bff/internal/relay). */
  baseUrl?: string;
  /** For tests. */
  fetch?: typeof globalThis.fetch;
};

/**
 * The browser's transport to the backend's own RPCs: the Connect protocol with JSON, to the
 * console's origin, where kube-auth-proxy authenticates the call (401, not a login redirect, on
 * these paths: --api-route) and the BFF relays it to the backend with the caller's token. Methods
 * the proto marks free of side effects are sent as GET.
 */
export const createConsoleTransport = ({
  checkSession,
  baseUrl = window.location.origin,
  fetch,
}: ConsoleTransportOptions = {}): Transport =>
  createConnectTransport({
    baseUrl,
    useHttpGet: true,
    interceptors: checkSession ? [sessionCheck(checkSession)] : [],
    ...(fetch ? { fetch } : {}),
  });
