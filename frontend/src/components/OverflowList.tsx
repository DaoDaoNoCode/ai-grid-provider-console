import { Flex, Label, List, ListItem, Popover } from '@patternfly/react-core';
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
    <Flex
      component="span"
      display={{ default: 'inlineFlex' }}
      alignItems={{ default: 'alignItemsCenter' }}
      spaceItems={{ default: 'spaceItemsSm' }}
    >
      {first}
      {rest.length > 0 && (
        <Popover
          headerContent={`${noun} (${items.length})`}
          bodyContent={
            <List isPlain>
              {items.map((item, index) => (
                <ListItem key={`${index}-${item}`}>{item}</ListItem>
              ))}
            </List>
          }
        >
          {/* The name starts with what the label shows ("+1 more"), then says what of. */}
          <Label isCompact variant="outline" onClick={() => undefined}>
            +{rest.length} more<span className="pf-v6-screen-reader"> {noun.toLowerCase()}</span>
          </Label>
        </Popover>
      )}
    </Flex>
  );
};
