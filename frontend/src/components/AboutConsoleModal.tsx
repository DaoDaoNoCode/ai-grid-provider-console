import { AboutModal, Content, ContentVariants } from '@patternfly/react-core';
import type { ConsoleConfig, User } from '../api/types';
import consoleMark from '../assets/console-mark.svg';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  config?: ConsoleConfig;
  user?: User;
};

/** Says this when a value isn't known yet, or the backend doesn't report it. */
const NOT_REPORTED = 'Not reported';

/**
 * The About dialog (PatternFly AboutModal): which console build is running, which backend it
 * talks to, and who is signed in. The backend has no version RPC yet, so its version reads
 * "Not reported" until it does.
 */
export const AboutConsoleModal: React.FC<Props> = ({ isOpen, onClose, config, user }) => (
  <AboutModal
    isOpen={isOpen}
    onClose={onClose}
    productName="Cloud Provider Admin Console"
    brandImageSrc={consoleMark}
    brandImageAlt="Cloud Provider Admin Console"
  >
    <Content>
      <Content component={ContentVariants.dl}>
        <Content component={ContentVariants.dt}>Console version</Content>
        <Content component={ContentVariants.dd}>{config?.version || NOT_REPORTED}</Content>
        <Content component={ContentVariants.dt}>Backend</Content>
        <Content component={ContentVariants.dd}>
          {config ? (config.fakeBackend ? 'Fake backend (fixture data)' : 'AI Grid backend') : NOT_REPORTED}
        </Content>
        <Content component={ContentVariants.dt}>Backend version</Content>
        <Content component={ContentVariants.dd}>{NOT_REPORTED}</Content>
        <Content component={ContentVariants.dt}>Signed in as</Content>
        <Content component={ContentVariants.dd}>
          {user ? `${user.username}${user.isProviderAdmin ? ' (provider admin)' : ''}` : NOT_REPORTED}
        </Content>
      </Content>
    </Content>
  </AboutModal>
);
