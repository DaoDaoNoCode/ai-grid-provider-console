import { FormGroup, FormHelperText, HelperText, HelperTextItem, TextInput } from '@patternfly/react-core';

type Props = {
  label: string;
  fieldId: string;
  value: string;
  /** Why it can't be changed here, shown under the field and read with it. */
  reason: string;
};

/**
 * A field an edit wizard shows but can't change, in the place its create wizard edits it: a
 * PatternFly read-only input, so the value stays readable, selectable and in the tab order, with
 * the reason under it.
 */
export const ReadOnlyField: React.FC<Props> = ({ label, fieldId, value, reason }) => (
  <FormGroup label={label} fieldId={fieldId}>
    <TextInput id={fieldId} value={value} readOnlyVariant="default" aria-describedby={`${fieldId}-fixed`} />
    <FormHelperText>
      <HelperText id={`${fieldId}-fixed`}>
        <HelperTextItem>{reason}</HelperTextItem>
      </HelperText>
    </FormHelperText>
  </FormGroup>
);
