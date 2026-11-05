import { useEffect } from 'react';
import {
  useVariableDefinitionActions,
  useVariableDefinitionAndState,
  useVariableDefinitionStates,
} from '@perses-dev/dashboards';
import { CLUSTER_VARIABLE, clusterDetailsValues, type ClusterLookup } from './clusterDetails';

type Props = {
  /** The dashboard's CLUSTER_DETAILS_* variables (clusterDetailsVariables). */
  names: string[];
  lookup: ClusterLookup;
};

/**
 * Sets the dashboard's cluster details variables for the cluster its cluster variable selects, as
 * odh-dashboard's ClusterDetailsVariablesProvider does. Inside Perses's variable provider, which
 * also writes each value to the URL as var-<name>, as it does for every variable.
 */
export const ClusterDetailsVariables: React.FC<Props> = ({ names, lookup }) => {
  const { definition, state } = useVariableDefinitionAndState(CLUSTER_VARIABLE);
  const { setVariableValue } = useVariableDefinitionActions();
  const current = useVariableDefinitionStates(names);
  const wanted = clusterDetailsValues(names, definition ? (state?.value ?? null) : undefined, lookup);
  // The values that differ from the store's, as one string, so the effect runs when they change and
  // again if something else (the URL's var-<name>, which Perses reads back) puts an old one back.
  const pending = JSON.stringify(Object.entries(wanted).filter(([n, v]) => current[n]?.value !== v));
  useEffect(() => {
    for (const [name, value] of JSON.parse(pending) as [string, string][]) {
      setVariableValue(name, value);
    }
  }, [pending, setVariableValue]);
  return null;
};
