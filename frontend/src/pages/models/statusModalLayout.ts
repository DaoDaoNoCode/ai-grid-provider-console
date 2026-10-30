import type { ModalProps } from '@patternfly/react-core';

/**
 * Every model status dialog uses this size and place (from console #114): medium, centered, attached
 * to the document, so a cluster's dialog opened from the model's dialog covers the same rectangle.
 */
export const statusModalLayout = {
  variant: 'medium',
  position: 'default',
  appendTo: () => document.body,
} satisfies Pick<ModalProps, 'variant' | 'position' | 'appendTo'>;
