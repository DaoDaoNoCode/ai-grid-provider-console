import { Bullseye, PageSection, Spinner } from '@patternfly/react-core';

type Props = {
  /** The spinner's accessible name, e.g. "Loading clusters". */
  label: string;
};

/**
 * A page's content while it loads: a spinner in the middle of the page, not in its top left
 * corner. A whole filled section, rendered in place of the page's content section: a page section
 * is a flex column, so without the body wrapper the Bullseye can grow to the section's height.
 */
export const PageLoading: React.FC<Props> = ({ label }) => (
  <PageSection isFilled hasBodyWrapper={false}>
    <Bullseye className="pf-v6-u-flex-grow-1">
      <Spinner aria-label={label} />
    </Bullseye>
  </PageSection>
);
