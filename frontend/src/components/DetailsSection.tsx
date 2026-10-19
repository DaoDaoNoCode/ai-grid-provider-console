import { Button, Flex, Stack, Title } from '@patternfly/react-core';

type Props = {
  title: string;
  /** On a wizard's Review step: goes back to the step that edits this section. */
  onEdit?: () => void;
  children: React.ReactNode;
};

/** A titled group of details, with an Edit link on a review step; every review and details page uses it. */
export const DetailsSection: React.FC<Props> = ({ title, onEdit, children }) => (
  <Stack hasGutter>
    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
      <Title headingLevel="h2" size="lg">
        {title}
      </Title>
      {onEdit && (
        <Button variant="link" isInline onClick={onEdit} aria-label={`Edit ${title.toLowerCase()}`}>
          Edit
        </Button>
      )}
    </Flex>
    {children}
  </Stack>
);
