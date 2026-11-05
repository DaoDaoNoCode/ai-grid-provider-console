import type { ModalProps } from '@patternfly/react-core';

/**
 * Every model status dialog uses this size and place: medium, centered, attached to the document.
 * The layout follows jgiardino/ai-grid-provider-console@a4e6090 statusModalLayout.ts.
 */
export const statusModalLayout = {
  variant: 'medium',
  position: 'default',
  appendTo: () => document.body,
} satisfies Pick<ModalProps, 'variant' | 'position' | 'appendTo'>;
