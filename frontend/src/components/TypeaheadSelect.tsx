// A single-value PatternFly typeahead select (PatternFly 6 "Select > Typeahead" example), so a
// form's one-of-many pickers draw the same menu as MultiSelection instead of the browser's.
import { useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import {
  MenuToggle,
  type MenuToggleElement,
  Select,
  SelectList,
  SelectOption,
  TextInputGroup,
  TextInputGroupMain,
} from '@patternfly/react-core';
import { resolveSelectPopperAppendTo, useModalOverflowUnlock } from './selectPopper';

export type TypeaheadSelectOption = {
  value: string;
  label: string;
  description?: string;
};

type Props = {
  /** The input's id, so a FormGroup or <label> can point at it. */
  id: string;
  value: string;
  options: TypeaheadSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Required: PatternFly's input otherwise announces itself as "Type to filter", over any <label>. */
  'aria-label': string;
  status?: 'danger';
  'data-testid'?: string;
};

export const TypeaheadSelect = ({
  id,
  value,
  options,
  onChange,
  placeholder,
  'aria-label': ariaLabel,
  status,
  'data-testid': testId,
}: Props) => {
  const [isOpen, setIsOpen] = useState(false);
  // What the user has typed since the menu opened; null shows the selected option's label.
  const [filter, setFilter] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const instanceId = useId().replace(/:/g, '');
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${instanceId}-option-${index}`;

  useModalOverflowUnlock(isOpen, inputRef);

  const selected = options.find((o) => o.value === value);
  const visible = useMemo(() => {
    const text = filter?.trim().toLowerCase();
    return text ? options.filter((o) => o.label.toLowerCase().includes(text)) : options;
  }, [filter, options]);

  const close = () => {
    setIsOpen(false);
    setFilter(null);
    setFocusedIndex(null);
  };

  const choose = (next: string) => {
    onChange(next);
    close();
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        setIsOpen(true);
        if (visible.length === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setFocusedIndex((i) =>
          i === null ? (step > 0 ? 0 : visible.length - 1) : (i + step + visible.length) % visible.length,
        );
        return;
      }
      case 'Enter':
        event.preventDefault();
        if (isOpen && focusedIndex !== null && visible[focusedIndex]) {
          choose(visible[focusedIndex].value);
        } else {
          setIsOpen(!isOpen);
        }
        return;
      case 'Escape':
        close();
        return;
    }
  };

  const toggle = (toggleRef: Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      variant="typeahead"
      isFullWidth
      isExpanded={isOpen}
      status={status}
      onClick={() => {
        setIsOpen(!isOpen);
        inputRef.current?.focus();
      }}
    >
      <TextInputGroup isPlain>
        <TextInputGroupMain
          inputId={id}
          inputProps={testId ? { 'data-testid': testId } : undefined}
          ref={inputRef}
          value={filter ?? selected?.label ?? ''}
          placeholder={placeholder}
          aria-label={ariaLabel}
          role="combobox"
          isExpanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && focusedIndex !== null ? optionId(focusedIndex) : undefined}
          autoComplete="off"
          onClick={() => setIsOpen(!isOpen)}
          onChange={(_event, text) => {
            setFilter(text);
            setFocusedIndex(null);
            setIsOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      </TextInputGroup>
    </MenuToggle>
  );

  return (
    <Select
      id={`${id}-select`}
      isOpen={isOpen}
      selected={value}
      onSelect={(_event, next) => {
        if (typeof next === 'string') choose(next);
      }}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      toggle={toggle}
      variant="typeahead"
      isScrollable
      popperProps={{ appendTo: () => resolveSelectPopperAppendTo(inputRef.current) }}
    >
      <SelectList id={listboxId} aria-label={ariaLabel}>
        {visible.length === 0 ? (
          <SelectOption isDisabled>No results found</SelectOption>
        ) : (
          visible.map((o, index) => (
            <SelectOption
              key={o.value}
              id={optionId(index)}
              value={o.value}
              description={o.description}
              isFocused={focusedIndex === index}
            >
              {o.label}
            </SelectOption>
          ))
        )}
      </SelectList>
    </Select>
  );
};
