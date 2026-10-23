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

  it('gives ECharts a literal font stack, since a <canvas> ignores CSS variables', () => {
    const { chartsTheme } = patternFlyTheme('light', 2026);
    const textStyle = chartsTheme.echartsTheme.textStyle as { fontFamily: string; fontSize: number };
    expect(textStyle.fontFamily).toMatch(/^"Red Hat Text"/);
    expect(textStyle.fontFamily).not.toContain('var(');
    expect(textStyle.fontSize).toBe(12);
  });

  it('fits two legend rows in the 40px legend box', () => {
    const { muiTheme } = patternFlyTheme('light', 2026);
    expect(muiTheme.components?.MuiListItemText?.styleOverrides?.dense).toEqual({ marginTop: 1, marginBottom: 1 });
  });
});
