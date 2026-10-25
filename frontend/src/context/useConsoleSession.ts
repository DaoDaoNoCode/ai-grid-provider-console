// The context and its hook, in their own module so a component module exports only components
// (as useMaaSGovernanceContext.ts does).
import { createContext, useContext } from 'react';
import type { ConsoleConfig, User } from '../api/types';

/**
 * What App loads once for every page: the signed-in user (each /user is a hub access review) and
 * the console's config. Pages read them here instead of asking the BFF again.
 */
export type ConsoleSession = {
  user?: User;
  userLoaded: boolean;
  userError?: Error;
  config?: ConsoleConfig;
  configError?: Error;
  /** A call has answered 401: the console goes through the login again instead of the pages, which stop polling. */
  sessionEnded?: boolean;
};

export const ConsoleSessionContext = createContext<ConsoleSession>({ userLoaded: false });

export const useConsoleSession = (): ConsoleSession => useContext(ConsoleSessionContext);
