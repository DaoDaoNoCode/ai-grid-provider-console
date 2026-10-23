// One Perses dashboard from the hub, rendered with Perses's own React components, as
// odh-dashboard's Observability page does (packages/observability). Loaded lazily: Perses, its
// MUI theme and its chart library add about 1 MB (gzipped) that no other page needs.
import { useState } from 'react';
import { Flex, FlexItem } from '@patternfly/react-core';
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
                            {/* One row: the dashboard's variables on the left, its time controls on the
                                right, both on the row's bottom edge so the inputs line up. */}
                            <Flex
                              justifyContent={{ default: 'justifyContentSpaceBetween' }}
                              alignItems={{ default: 'alignItemsFlexEnd' }}
                              flexWrap={{ default: 'wrap' }}
                            >
                              <FlexItem grow={{ default: 'grow' }} className="pf-v6-u-pb-sm">
                                {/* The padding offsets the toolbar's own margin-bottom: -8px, which lets
                                    the select hang 8px below the edge this row aligns on. */}
                                <DashboardStickyToolbar initialVariableIsSticky={false} />
                              </FlexItem>
                              <Flex
                                spaceItems={{ default: 'spaceItemsSm' }}
                                alignItems={{ default: 'alignItemsCenter' }}
                              >
                                <FlexItem>Time period:</FlexItem>
                                {/* As odh-dashboard's HeaderTimeRangeControls: no zoom buttons and no
                                    refresh-interval picker, whose fixed options (Off to 60s) can't show
                                    a dashboard's own interval such as ACM's 5m. That interval still
                                    applies; the refresh button refreshes now. */}
                                <TimeRangeControls
                                  showTimeRangeSelector
                                  showRefreshButton
                                  showRefreshInterval={false}
                                  showCustomTimeRange
                                  showZoomButtons={false}
                                  timeZone={timeZone}
                                  onTimeZoneChange={(option) => setTimeZone(option.value)}
                                />
                              </Flex>
                            </Flex>
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
