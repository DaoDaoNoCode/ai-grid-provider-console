// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/models/fields/RuntimeArgsField.tsx at 62319b8.
// Extracted from packages/model-serving/src/components/deploymentWizard/fields/RuntimeArgsField.tsx
// upstream commit: 8051fbbea117457b4da4074fb2856b732e6677a4
// The console has no serving runtime catalog, so the upstream "View predefined arguments" popover
// (which lists the selected runtime's arguments) is left out.
import React from 'react';
import {
  FormGroup,
  FormGroupLabelHelp,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Popover,
  TextArea,
} from '@patternfly/react-core';
import type { RuntimeArgsFieldData } from './runtimeArgs';

type RuntimeArgsFieldProps = {
  data?: RuntimeArgsFieldData;
  onChange?: (data: RuntimeArgsFieldData) => void;
};

export const RuntimeArgsField: React.FC<RuntimeArgsFieldProps> = ({
  data = { enabled: false, args: [] },
  onChange,
}) => {
  const [hasTyped, setHasTyped] = React.useState(false);
  const joined = data.args.join('\n');
  const displayValue = data.args.length > 0 && !hasTyped ? `${joined}\n` : joined;
  const handleTextAreaChange = (_e: React.FormEvent<HTMLTextAreaElement>, textValue: string) => {
    setHasTyped(true);
    const args = textValue.split('\n');
    onChange?.({ args, enabled: args.some((a) => a.trim().length > 0) });
  };

  return (
    <FormGroup
      label="Additional runtime arguments"
      fieldId="runtime-args-textarea"
      labelHelp={
        <Popover bodyContent="Serving runtime arguments define how the deployed model behaves. They override the runtime's own arguments for this deployment only.">
          <FormGroupLabelHelp aria-label="More info for additional runtime arguments" />
        </Popover>
      }
    >
      <TextArea
        id="runtime-args-textarea"
        data-testid="runtime-args-textarea"
        placeholder={`--arg\n--arg2=value2\n--arg3 value3`}
        value={displayValue}
        onChange={handleTextAreaChange}
        autoResize
      />
      <FormHelperText>
        <HelperText>
          <HelperTextItem>
            One argument per line. Overwriting the runtime&apos;s listening port or model location will likely make the
            deployment fail.
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
    </FormGroup>
  );
};
