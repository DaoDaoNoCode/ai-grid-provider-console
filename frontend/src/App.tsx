import {
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  SkipToContent,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ConsoleService } from './api/ConsoleService';
import { AppRoutes } from './AppRoutes';
import { FakeBackendBanner } from './components/FakeBackendBanner';
import { NoticeToast } from './components/NoticeToast';
import { AboutConsoleModal } from './components/AboutConsoleModal';
import { ProviderAdminsOnly } from './components/ProviderAdminsOnly';
import { SessionEndedAlert } from './components/SessionEndedAlert';
import { UserMenu } from './components/UserMenu';
import { watchSession } from './api/watchSession';
import { ConsoleSessionContext } from './context/useConsoleSession';
import { useServiceData } from './hooks/useServiceData';

type Props = { service: ConsoleService };

/** The page's main region, where Skip to content goes. */
const MAIN_ID = 'console-main';

// Section order and active-state matching follow the PoC (src/app/App.tsx at 62319b8):
// AI Grid and Monitoring match exactly, the others match by prefix.
const sections: { path: string; label: string; exact?: boolean }[] = [
  { path: '/ai-grid', label: 'AI Grid', exact: true },
  { path: '/monitoring', label: 'Monitoring', exact: true },
  { path: '/clusters', label: 'Clusters' },
  { path: '/organizations', label: 'Organizations' },
  { path: '/models', label: 'Models' },
  { path: '/subscriptions', label: 'Subscriptions' },
];

export const App: React.FC<Props> = ({ service: given }) => {
  // Any call answered 401 means the session has ended; the console then says so once, for every page.
  const [sessionEnded, setSessionEnded] = useState(false);
  const service = useMemo(() => watchSession(given, () => setSessionEnded(true)), [given]);
  // Loaded once here and given to every page through the session context.
  const [user, userLoaded, userError] = useServiceData(() => service.getUser(), undefined, 0);
  const [config, , configError] = useServiceData(() => service.getConfig(), undefined, 0);
  const session = useMemo(
    () => ({ user, userLoaded, userError, config, configError, sessionEnded }),
    [user, userLoaded, userError, config, configError, sessionEnded],
  );
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);

  const header = (
    <Masthead display={{ default: 'inline' }}>
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton
            isHamburgerButton
            isSidebarOpen={sidebarOpen}
            onSidebarToggle={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
            aria-controls="console-sidebar"
          />
        </MastheadToggle>
        <MastheadBrand>
          <MastheadLogo component="span" className="pf-v6-u-display-flex pf-v6-u-align-items-center">
            {/* The product name, not a heading: each page's h1 is the first heading. */}
            <span className="pf-v6-c-title pf-m-lg">Cloud Provider Admin Console</span>
          </MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar isFullHeight isStatic>
          <ToolbarContent>
            <ToolbarItem align={{ default: 'alignEnd' }}>
              <UserMenu
                user={user}
                loaded={userLoaded}
                error={userError}
                canSignOut={config?.fakeBackend !== true}
                onAbout={() => setAboutOpen(true)}
              />
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  const sidebar = (
    <PageSidebar id="console-sidebar" isSidebarOpen={sidebarOpen}>
      <PageSidebarBody>
        <Nav aria-label="Console sections">
          <NavList>
            {sections.map((s) => (
              <NavItem key={s.path} isActive={s.exact ? pathname === s.path : pathname.startsWith(s.path)}>
                <Link to={s.path}>{s.label}</Link>
              </NavItem>
            ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <ConsoleSessionContext.Provider value={session}>
      <Page
        isContentFilled
        masthead={header}
        sidebar={sidebar}
        banner={<FakeBackendBanner />}
        mainContainerId={MAIN_ID}
        skipToContent={<SkipToContent href={`#${MAIN_ID}`}>Skip to content</SkipToContent>}
      >
        {sessionEnded && <SessionEndedAlert />}
        <NoticeToast />
        {/* Only an answer that says so, never a user still loading or failing to load. */}
        {user?.isProviderAdmin === false ? (
          <ProviderAdminsOnly username={user.username} />
        ) : (
          <AppRoutes service={service} />
        )}
        <AboutConsoleModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} config={config} user={user} />
      </Page>
    </ConsoleSessionContext.Provider>
  );
};
