// The pages AppRoutes loads with React.lazy, loaded before the file's tests run. Otherwise the
// first test that opens one waits for its module inside a findBy, whose 1 s limit the import alone
// can use up on a busy machine. Keep this list the same as AppRoutes'.
await Promise.all([
  import('./src/pages/clusters/ClusterDetailsPage'),
  import('./src/pages/grid/GridPage'),
  import('./src/pages/monitoring/MonitoringPage'),
  import('./src/pages/models/ModelDetailsPage'),
  import('./src/pages/models/ModelEditPage'),
  import('./src/pages/models/ModelWizard'),
  import('./src/pages/models/ModelsPage'),
  import('./src/pages/organizations/OrganizationDetailsPage'),
  import('./src/pages/organizations/OrganizationListPage'),
  import('./src/pages/organizations/OrganizationWizardPage'),
  import('./src/pages/subscriptions/CreateSubscriptionPage'),
  import('./src/pages/subscriptions/EditSubscriptionPage'),
  import('./src/pages/subscriptions/SubscriptionsPage'),
  import('./src/pages/subscriptions/ViewSubscriptionPage'),
]);

// A module, so it can await at the top level.
export {};
