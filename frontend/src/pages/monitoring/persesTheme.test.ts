import { describe, expect, it } from 'vitest';
import { patternFlyTheme, patternflyChartsMultiUnorderedPalette } from './persesTheme';

describe('patternFlyTheme', () => {
  it("uses PatternFly's 35-color unordered chart palette, as hex for ECharts' canvas", () => {
    expect(patternflyChartsMultiUnorderedPalette).toHaveLength(35);
    expect(patternflyChartsMultiUnorderedPalette[0]).toBe('#0066cc');
    expect(patternflyChartsMultiUnorderedPalette.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
  });

  it('styles Perses with PatternFly fonts and the palette', () => {
    const { muiTheme, chartsTheme } = patternFlyTheme('light', 2026);
    expect(muiTheme.palette.mode).toBe('light');
    expect(muiTheme.typography.fontFamily).toBe('var(--pf-t--global--font--family--body)');
    expect(chartsTheme.echartsTheme.color).toEqual(patternflyChartsMultiUnorderedPalette);
  });
});
