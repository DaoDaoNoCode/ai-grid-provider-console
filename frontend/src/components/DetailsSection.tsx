import { Button, Flex, Label, Stack, Title } from '@patternfly/react-core';
import { HelpPopover } from './HelpPopover';

type Props = {
  title: string;
  /** How many items the section lists, beside its title. */
  count?: number;
  /** Background on the section, in a help popover beside its title. */
  help?: React.ReactNode;
  /** On a wizard's Review step: goes back to the step that edits this section. */
  onEdit?: () => void;
  /** h2 on a page; h3 inside a drawer, under the drawer's own h2. */
  headingLevel?: 'h2' | 'h3';
  children: React.ReactNode;
};

/** A titled group of details, with an Edit link on a review step; every review, details page and drawer uses it. */
export const DetailsSection: React.FC<Props> = ({ title, count, help, onEdit, headingLevel = 'h2', children }) => (
  <Stack hasGutter>
    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
      <Title headingLevel={headingLevel} size={headingLevel === 'h2' ? 'lg' : 'md'}>
        {title}
      </Title>
      {count !== undefined && <Label isCompact>{count}</Label>}
      {help && <HelpPopover topic={title}>{help}</HelpPopover>}
      {onEdit && (
        <Button variant="link" isInline onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
          Edit
        </Button>
      )}
    </Flex>
    {children}
  </Stack>
);
