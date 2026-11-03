import type { ToolbarItemProps } from '@patternfly/react-core';

/**
 * A toolbar's search box or select: the same width everywhere, wide enough for its placeholder
 * (ToolbarItem's widths, which set PatternFly's toolbar item width variable).
 */
export const TOOLBAR_FIELD_WIDTHS: ToolbarItemProps['widths'] = { default: '22rem' };
