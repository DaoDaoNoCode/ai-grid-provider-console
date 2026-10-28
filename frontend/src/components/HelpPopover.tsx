import { Button, Popover } from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';

type Props = {
  /** What the help is about, for the button's accessible name, for example "Models on this cluster". */
  topic: string;
  children: React.ReactNode;
};

/**
 * Background a reader may want but doesn't need on screen (how a number is worked out, where data
 * comes from), behind a help icon beside a heading or label instead of a line of small print.
 */
export const HelpPopover: React.FC<Props> = ({ topic, children }) => (
  <Popover bodyContent={children}>
    <Button
      variant="plain"
      hasNoPadding
      aria-label={`More about ${topic.toLowerCase()}`}
      icon={<OutlinedQuestionCircleIcon />}
    />
  </Popover>
);
