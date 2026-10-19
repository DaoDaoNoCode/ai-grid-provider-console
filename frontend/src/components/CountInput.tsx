import { NumberInput } from '@patternfly/react-core';

type Props = {
  id: string;
  /** The accessible name, the same as the field's label. */
  label: string;
  /** The text the user typed, so an empty or partial entry can show its error. */
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
  onBlur?: () => void;
  validated?: 'error' | 'default';
  isDisabled?: boolean;
};

/** A whole-number field with − and + buttons, kept short (PatternFly's number input). */
export const CountInput: React.FC<Props> = ({
  id,
  label,
  value,
  min,
  max,
  onChange,
  onBlur,
  validated,
  isDisabled,
}) => {
  const current = Number.parseInt(value, 10);
  const step = (delta: number) =>
    onChange(String(Math.min(max, Math.max(min, (Number.isNaN(current) ? min : current) + delta))));
  return (
    <NumberInput
      id={id}
      inputName={id}
      inputAriaLabel={label}
      minusBtnAriaLabel={`Decrease ${label.toLowerCase()}`}
      plusBtnAriaLabel={`Increase ${label.toLowerCase()}`}
      value={Number.isNaN(current) ? '' : current}
      min={min}
      max={max}
      widthChars={4}
      validated={validated}
      isDisabled={isDisabled}
      onMinus={() => step(-1)}
      onPlus={() => step(1)}
      onChange={(event: React.FormEvent<HTMLInputElement>) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
    />
  );
};
