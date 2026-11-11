// Adapted from odh-dashboard packages/model-serving/src/components/deploymentWizard/fields/modelCapabilities/ModelCapabilitiesField.tsx.
// upstream commit: e8709851e7c147666c925709f42337b40407785e
// The upstream custom capability input is left out: the menu offers the well-known values only. A
// value the model already has that isn't one of them still shows, and can be removed.
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  Flex,
  FlexItem,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Label,
} from '@patternfly/react-core';
import { PlusCircleIcon } from '@patternfly/react-icons';
import { resolveSelectPopperAppendTo } from '../../../components/selectPopper';
import { WELL_KNOWN_CAPABILITIES, capabilityColor, includesCapability } from '../modelCapabilities';

type Props = {
  /** The selected values, in the order they were added. */
  value: string[];
  onChange: (value: string[]) => void;
  isDisabled?: boolean;
};

export const ModelCapabilitiesField: React.FC<Props> = ({ value, onChange, isDisabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const lastCloseRef = useRef<HTMLButtonElement>(null);
  const available = WELL_KNOWN_CAPABILITIES.filter((capability) => !includesCapability(value, capability));
  // A change that takes away the focused control (a removed label's close button, or Add capability
  // once nothing is left to add) moves focus to Add capability, or else to the last label's close
  // button, once the field shows the change. Selecting another value focuses Add capability itself
  // (the Dropdown's shouldFocusToggleOnSelect).
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    (toggleRef.current ?? lastCloseRef.current)?.focus();
  }, [value]);
  const change = (next: string[]) => {
    refocus.current = true;
    onChange(next);
  };

  return (
    <FormGroup
      label="Model capabilities"
      fieldId="model-capabilities"
      role="group"
      aria-describedby="model-capabilities-help"
    >
      <Flex gap={{ default: 'gapSm' }} alignItems={{ default: 'alignItemsCenter' }}>
        {value.map((capability, index) => (
          <FlexItem key={capability}>
            <Label
              isCompact
              color={capabilityColor(capability)}
              onClose={isDisabled ? undefined : () => change(value.filter((v) => v !== capability))}
              closeBtnAriaLabel={`Remove ${capability}`}
              closeBtnProps={index === value.length - 1 ? { ref: lastCloseRef } : undefined}
            >
              {capability}
            </Label>
          </FlexItem>
        ))}
        {available.length > 0 && (
          <FlexItem>
            <Dropdown
              isOpen={isOpen}
              onOpenChange={setIsOpen}
              onSelect={(_event, selected) => {
                if (typeof selected === 'string') {
                  const next = [...value, selected];
                  // The last value left to add takes Add capability away.
                  if (available.length === 1) change(next);
                  else onChange(next);
                }
                setIsOpen(false);
              }}
              shouldFocusToggleOnSelect
              // Outside the wizard step, as the console's other menus attach, so it isn't clipped at
              // the bottom of Advanced settings.
              popperProps={{ appendTo: () => resolveSelectPopperAppendTo(toggleRef.current) }}
              toggle={{
                toggleRef,
                toggleNode: (
                  <Button
                    ref={toggleRef}
                    variant="link"
                    icon={<PlusCircleIcon />}
                    isDisabled={isDisabled}
                    onClick={() => setIsOpen(!isOpen)}
                    aria-haspopup="menu"
                    aria-expanded={isOpen}
                  >
                    Add capability
                  </Button>
                ),
              }}
            >
              <DropdownList>
                {available.map((capability) => (
                  <DropdownItem key={capability} value={capability}>
                    <Label isCompact color={capabilityColor(capability)}>
                      {capability}
                    </Label>
                  </DropdownItem>
                ))}
              </DropdownList>
            </Dropdown>
          </FlexItem>
        )}
      </Flex>
      <FormHelperText>
        <HelperText id="model-capabilities-help">
          <HelperTextItem>
            Tag this model with its capabilities so users can easily identify what it supports.
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
    </FormGroup>
  );
};
