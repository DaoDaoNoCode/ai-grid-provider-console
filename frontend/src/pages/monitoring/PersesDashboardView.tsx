// One Perses dashboard from the hub, rendered with Perses's own React components, as
// odh-dashboard's Observability page does (packages/observability). Loaded lazily: Perses, its
// MUI theme and its chart library add about 1 MB (gzipped) that no other page needs.
import { useState } from 'react';
import { Flex } from '@patternfly/react-core';
import { ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChartsProvider, SnackbarProvider } from '@perses-dev/components';
import type { DashboardResource } from '@perses-dev/client';
import {
  DataQueriesProvider,
  PluginRegistry,
  TimeRangeControls,
  TimeRangeProviderBasic,
} from '@perses-dev/plugin-system';
import {
  Dashboard,
  DashboardProvider,
  DashboardStickyToolbar,
  DatasourceStoreProvider,
  PanelFocusProvider,
  VariableProvider,
} from '@perses-dev/dashboards';
import { QueryParamProvider } from 'use-query-params';
import { ReactRouter6Adapter } from 'use-query-params/adapters/react-router-6';
import { RelayDatasourceApi } from './persesDatasourceApi';
import { pluginLoader } from './persesPlugins';
import { patternFlyTheme } from './persesTheme';

// PatternFly's look for Perses, as odh-dashboard and the OpenShift console's monitoring plugin do.
const { muiTheme, chartsTheme } = patternFlyTheme();
const datasourceApi = new RelayDatasourceApi();
// One cache for the page: switching tabs back reuses the answers until they're refetched.
const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 0 } } });

type Props = { dashboard: DashboardResource };

/** The dashboard's time range, refresh, variables and panels. */
const PersesDashboardView: React.FC<Props> = ({ dashboard }) => {
  const [timeZone, setTimeZone] = useState('local');
  return (
    <QueryClientProvider client={queryClient}>
      <QueryParamProvider adapter={ReactRouter6Adapter}>
        <ThemeProvider theme={muiTheme}>
          <ChartsProvider chartsTheme={chartsTheme}>
            <SnackbarProvider anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} variant="default">
              <PluginRegistry pluginLoader={pluginLoader}>
                <PanelFocusProvider>
                  <TimeRangeProviderBasic
                    initialTimeRange={{ pastDuration: dashboard.spec.duration || '1h' }}
                    initialRefreshInterval={dashboard.spec.refreshInterval || '0s'}
                  >
                    <VariableProvider initialVariableDefinitions={dashboard.spec.variables}>
                      <DatasourceStoreProvider dashboardResource={dashboard} datasourceApi={datasourceApi}>
                        <DataQueriesProvider definitions={[]}>
                          <DashboardProvider initialState={{ isEditMode: false, dashboardResource: dashboard }}>
                            <Flex justifyContent={{ default: 'justifyContentFlexEnd' }}>
                              <TimeRangeControls
                                timeZone={timeZone}
                                onTimeZoneChange={(option) => setTimeZone(option.value)}
                              />
                            </Flex>
                            <DashboardStickyToolbar initialVariableIsSticky={false} />
                            <Dashboard />
                          </DashboardProvider>
                        </DataQueriesProvider>
                      </DatasourceStoreProvider>
                    </VariableProvider>
                  </TimeRangeProviderBasic>
                </PanelFocusProvider>
              </PluginRegistry>
            </SnackbarProvider>
          </ChartsProvider>
        </ThemeProvider>
      </QueryParamProvider>
    </QueryClientProvider>
  );
};

export default PersesDashboardView;
