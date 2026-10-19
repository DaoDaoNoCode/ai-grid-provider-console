import {
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
} from '@patternfly/react-core';
import { EMPTY_VALUE, hasValue } from '../utilities/format';

export type DetailsItem = {
  term: string;
  value?: React.ReactNode;
  'data-testid'?: string;
};

type Props = {
  items: DetailsItem[];
  /** Leave out items without a value, for example optional fields on a review step. */
  hideEmpty?: boolean;
  /** The term column's width; narrower inside drawers and cards. */
  termWidth?: string;
  'aria-label'?: string;
};

/**
 * Name-value details, laid out the same on every page: PatternFly's horizontal description list
 * with left-aligned values and one term width, so terms stay on one line and values line up.
 * A missing value reads as EMPTY_VALUE.
 */
export const DetailsList: React.FC<Props> = ({ items, hideEmpty, termWidth = '14rem', 'aria-label': ariaLabel }) => (
  <DescriptionList isHorizontal isCompact horizontalTermWidthModifier={{ default: termWidth }} aria-label={ariaLabel}>
    {items
      .filter((item) => !hideEmpty || hasValue(item.value))
      .map((item) => (
        <DescriptionListGroup key={item.term}>
          <DescriptionListTerm>{item.term}</DescriptionListTerm>
          <DescriptionListDescription data-testid={item['data-testid']}>
            {hasValue(item.value) ? item.value : EMPTY_VALUE}
          </DescriptionListDescription>
        </DescriptionListGroup>
      ))}
  </DescriptionList>
);
