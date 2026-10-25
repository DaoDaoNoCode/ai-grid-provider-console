import { LoadError } from '../../components/LoadError';

/** A failed load of one organization: not available yet on a 501, else the PoC's error. */
export const OrganizationLoadError: React.FC<{ error: Error }> = ({ error }) => (
  <LoadError subject="Organizations" error={error} title="Error loading organization" />
);
