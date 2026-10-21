import { Card, CardBody, CardTitle, Flex, Icon } from '@patternfly/react-core';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';

type Props = {
  label: string;
  value: string;
  /** Beside the value, such as "%". */
  unit?: string;
  /** A word after the value, such as "Ready" after "2/3". */
  detail?: string;
  /** Flags the value with a warning icon; the text is the icon's accessible name. */
  warning?: string;
};

/**
 * One headline number on a compact card. The AI Grid summary and the Monitoring overview lay a
 * row of these out in a Gallery.
 */
export const StatCard: React.FC<Props> = ({ label, value, unit, detail, warning }) => (
  <Card isCompact isFullHeight>
    <CardTitle>{label}</CardTitle>
    <CardBody>
      <Flex alignItems={{ default: 'alignItemsBaseline' }} spaceItems={{ default: 'spaceItemsSm' }}>
        <span className="pf-v6-u-font-size-2xl pf-v6-u-font-weight-bold">
          {value}
          {unit && <span className="pf-v6-u-font-size-sm pf-v6-u-text-color-subtle"> {unit}</span>}
        </span>
        {detail && <span className="pf-v6-u-font-size-sm pf-v6-u-text-color-subtle">{detail}</span>}
        {warning && (
          <Icon status="warning">
            <ExclamationTriangleIcon title={warning} />
          </Icon>
        )}
      </Flex>
    </CardBody>
  </Card>
);
