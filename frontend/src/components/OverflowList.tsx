import { Label, List, ListItem, Popover } from '@patternfly/react-core';
import { EMPTY_VALUE } from '../utilities/format';

type Props = {
  items: string[];
  /** What the items are, for the popover's title and the label's accessible name, e.g. "Locations". */
  noun: string;
};

/**
 * A short list in a table cell (PatternFly's table guidelines): the first item, then a "+N more"
 * label that opens the whole list in a popover, instead of expanding a nested table for a few
 * names. An empty list reads as EMPTY_VALUE.
 */
export const OverflowList: React.FC<Props> = ({ items, noun }) => {
  if (items.length === 0) {
    return <>{EMPTY_VALUE}</>;
  }
  const [first, ...rest] = items;
  return (
    <span className="console-overflow-list">
      {first}
      {rest.length > 0 && (
        <Popover
          headerContent={`${noun} (${items.length})`}
          bodyContent={
            <List isPlain>
              {items.map((item) => (
                <ListItem key={item}>{item}</ListItem>
              ))}
            </List>
          }
        >
          <Label
            isCompact
            variant="outline"
            onClick={() => undefined}
            aria-label={`All ${items.length} ${noun.toLowerCase()}`}
          >
            +{rest.length} more
          </Label>
        </Popover>
      )}
    </span>
  );
};
