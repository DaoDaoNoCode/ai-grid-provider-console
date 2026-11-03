import { SearchInput, ToolbarItem } from '@patternfly/react-core';
import { TOOLBAR_FIELD_WIDTHS } from './toolbarField';

type Props = {
  /** The accessible name, for example "Search clusters". */
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  'data-testid'?: string;
};

/** A list's search box, the same width on every list page so its placeholder isn't cut off. */
export const ToolbarSearch: React.FC<Props> = ({ label, placeholder, value, onChange, 'data-testid': testId }) => (
  <ToolbarItem widths={TOOLBAR_FIELD_WIDTHS}>
    <SearchInput
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(_event, next) => onChange(next)}
      onClear={() => onChange('')}
      data-testid={testId}
    />
  </ToolbarItem>
);
