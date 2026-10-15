import {
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  Page,
  PageSection,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import type { ConsoleService } from './api/ConsoleService';
import { useServiceData } from './hooks/useServiceData';
import { ClustersPage } from './pages/ClustersPage';

type Props = { service: ConsoleService };

export const App: React.FC<Props> = ({ service }) => {
  const [user, userLoaded, userError] = useServiceData(() => service.getUser(), undefined, 0);

  const header = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <MastheadLogo component="span">
            <Title headingLevel="h1" size="lg">
              AI Grid provider console
            </Title>
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isFullHeight isStatic>
          <ToolbarContent>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <span data-testid="masthead-user">
                {userError ? 'Not signed in' : !userLoaded ? 'Signing in…' : user?.username}
                {user?.isProviderAdmin ? ' (provider admin)' : ''}
              </span>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  return (
    <Page masthead={header}>
      <PageSection>
        <ClustersPage service={service} canEdit={user?.isProviderAdmin ?? false} />
      </PageSection>
    </Page>
  );
};
