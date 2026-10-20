type Props = { children: React.ReactNode };

/**
 * Secondary text in a layout (a card's second line, a note under a list, a timestamp): PatternFly's
 * small, subtle text utilities. Inside prose, use Content's own small text instead.
 */
export const SubtleText: React.FC<Props> = ({ children }) => (
  <span className="pf-v6-u-font-size-sm pf-v6-u-text-color-subtle">{children}</span>
);
