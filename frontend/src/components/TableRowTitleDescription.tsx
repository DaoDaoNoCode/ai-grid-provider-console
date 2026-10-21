// Ported from krisv/ai-grid-cloud-provider-poc src/shared/components/TableRowTitleDescription.tsx at 62319b8.
// Adapted from frontend/src/components/table/TableRowTitleDescription.tsx
// opendatahub-io/odh-dashboard commit 8051fbbea117457b4da4074fb2856b732e6677a4
// The console never passes a description, so the clamped description and its inline style are gone.

type Props = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
};

/** A table cell's title, with an optional subtitle under it. */
export const TableRowTitleDescription: React.FC<Props> = ({ title, subtitle }) => (
  <div>
    <div data-testid="table-row-title">{title}</div>
    {subtitle}
  </div>
);
