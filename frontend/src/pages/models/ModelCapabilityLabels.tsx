// Adapted from odh-dashboard packages/model-serving/src/components/deployments/DeploymentCapabilities.tsx.
// upstream commit: 5e7283b3eba64c87d710f0835988861004ee0ecc
// A model's capabilities as compact labels, each in its color, as the Models list shows clusters.
import { Label, LabelGroup } from '@patternfly/react-core';
import { capabilityColor } from './modelCapabilities';

export const ModelCapabilityLabels: React.FC<{ values: string[] }> = ({ values }) => (
  <LabelGroup numLabels={5}>
    {values.map((value) => (
      <Label key={value} color={capabilityColor(value)} isCompact>
        {value}
      </Label>
    ))}
  </LabelGroup>
);
