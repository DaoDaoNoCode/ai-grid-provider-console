import { render } from '@testing-library/react';
import type { EChartsOption } from 'echarts';
import { BarChartBase } from '@perses-dev/bar-chart-plugin/lib/BarChartBase.js';
import { pluginLoader } from './persesPlugins';

// The bar chart hands ECharts its option through Perses's EChart component; keep the option so the
// test can call the tooltip formatters ECharts would. The theme is only read for the no-data option.
const option = vi.hoisted(() => ({ current: undefined as EChartsOption | undefined }));
vi.mock('@perses-dev/components', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@perses-dev/components')>()),
  EChart: ({ option: given }: { option: EChartsOption }) => {
    option.current = given;
    return null;
  },
  useChartsTheme: () => ({ noDataOption: {} }),
}));

type Formatter = (params: unknown) => string;
const formatter = () => (option.current?.tooltip as { formatter: Formatter }).formatter;

/** The tooltip as the browser shows it: ECharts sets the formatter's string as innerHTML. */
const shown = (html: string) => {
  const tooltip = document.createElement('div');
  tooltip.innerHTML = html;
  return tooltip;
};

it('registers the bar chart panel', async () => {
  const resources = await pluginLoader.getInstalledPlugins();
  const bar = resources.find((r) => r.spec.plugins.some((p) => p.kind === 'Panel' && p.spec.name === 'BarChart'));
  expect(bar).toBeDefined();
  const module = (await pluginLoader.importPluginModule(bar!)) as Record<string, unknown>;
  expect(module.BarChart).toMatchObject({ PanelComponent: expect.any(Function) });
});

describe('the bar chart tooltip (patched)', () => {
  beforeEach(() => {
    option.current = undefined;
  });

  it('shows a bar name as written, and its value', () => {
    render(<BarChartBase width={400} height={200} data={[{ label: 'Fast <1s', value: 3 }]} />);
    const html = formatter()({ name: 'Fast <1s', data: ['Fast <1s', 3] });
    expect(html).toContain('<b>Fast &lt;1s</b>');
    expect(shown(html).textContent).toContain('Fast <1s');
    expect(html).toContain('3');
  });

  it.each([false, true])('shows grouped category and series names as written (stacked: %s)', (isStacked) => {
    render(
      <BarChartBase
        width={400}
        height={200}
        data={null}
        isStacked={isStacked}
        groupedData={{ categories: ['<b>p99</b>'], series: [{ name: `a & b < c "d" 'e'`, values: [7] }] }}
      />,
    );
    const html = formatter()([{ name: '<b>p99</b>', seriesName: `a & b < c "d" 'e'`, data: 7, color: '#06c' }]);
    expect(html).toContain('<b>&lt;b&gt;p99&lt;/b&gt;</b>');
    expect(html).toContain('a &amp; b &lt; c &quot;d&quot; &#39;e&#39;: ');
    const tooltip = shown(html);
    // Only the tooltip's own elements: the header, the marker and the value.
    expect(tooltip.querySelectorAll('b')).toHaveLength(2);
    expect(tooltip.textContent).toContain(`<b>p99</b>a & b < c "d" 'e': 7`);
    // The value and the marker color stay as they were.
    expect(html).toContain('<b>7</b>');
    expect(html).toContain('background-color:#06c');
  });

  it('keeps a marker color inside its style attribute', () => {
    render(
      <BarChartBase
        width={400}
        height={200}
        data={null}
        groupedData={{ categories: ['p99'], series: [{ name: 'latency', values: [7] }] }}
      />,
    );
    const html = formatter()([{ name: 'p99', seriesName: 'latency', data: 7, color: '#06c" title="x' }]);
    expect(html).toContain('background-color:#06c&quot; title=&quot;x"');
    expect(shown(html).querySelector('span')?.getAttribute('title')).toBeNull();
  });
});
