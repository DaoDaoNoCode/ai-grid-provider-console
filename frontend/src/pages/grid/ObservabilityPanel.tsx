// Layout and visual styling adapted from the cloned ProviderAdminObservabilityPage.
// Ported from krisv/ai-grid-cloud-provider-poc src/app/pages/grid/ObservabilityPanel.tsx at 62319b8.
// The PoC's tenants are the console's organizations; visible text says "organization". The console
// uses plain section headings, PatternFly tables with right-aligned numbers, round axis ticks, and
// horizontal usage bars with a legend.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Card, CardBody, Flex, Spinner, Tab, Tabs, TabTitleText, Title } from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link } from 'react-router-dom';
import type { GridCluster, GridMetric, GridRange, ManagedModel, Organization } from '../../api/types';
import { HelpPopover } from '../../components/HelpPopover';
import { StatusLabel } from '../../components/StatusLabel';
import { TypeaheadSelect } from '../../components/TypeaheadSelect';
import { modelKey } from '../../utilities/authpolicies';
import { EMPTY_VALUE } from '../../utilities/format';
import { modelMetrics, tenantUsage, total } from '../../services/demoObservability';
import { modelPath } from '../models/modelUtils';
import { AXIS_INTERVALS, niceCeiling, tickLabel } from './chartScale';
import './observability.css';

/** A titled part of a tab, with optional background in a help popover. */
function Section({ title, help, children }: { title: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="observability-section">
      <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
        <Title headingLevel="h2" size="lg">
          {title}
        </Title>
        {help && <HelpPopover topic={title}>{help}</HelpPopover>}
      </Flex>
      {children}
    </section>
  );
}

function Stat({ label, value, unit, warn = false }: { label: string; value: string; unit?: string; warn?: boolean }) {
  return (
    <div className={`observability-stat-card${warn ? ' observability-stat-card--warn' : ''}`}>
      <div className="observability-stat-card__label">{label}</div>
      <div className="observability-stat-card__value">
        {value}
        {unit && <span className="observability-stat-card__unit">{unit}</span>}
      </div>
    </div>
  );
}

const ticks = Array.from({ length: AXIS_INTERVALS + 1 }, (_, i) => i / AXIS_INTERVALS);

/** A hand-drawn SVG area chart of one series, with a hover readout. Its title carries the unit. */
export function MetricChart({ metric }: { metric: GridMetric }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replaceAll(':', '');
  const points = metric.points;
  const last = points.at(-1);
  const first = points[0];
  const start = first?.timestamp ?? 0;
  const end = last?.timestamp ?? 1;
  const ceiling = metric.unit === '%' ? 100 : niceCeiling(Math.max(0, ...points.map((p) => p.value)));
  const x = (timestamp: number) => 48 + ((timestamp - start) / (end - start || 1)) * 506;
  const y = (value: number) => 156 - (value / ceiling) * 132;
  const path = points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.timestamp)} ${y(p.value)}`).join(' ');
  const color =
    metric.key === 'gpu'
      ? '#0066cc'
      : metric.key === 'requests'
        ? '#3e8635'
        : metric.key === 'errors'
          ? '#c9190b'
          : '#6b46c1';
  const point = hover === null ? undefined : points[hover];
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: ceiling < 5 ? 3 : 1 });
  const readoutX = point ? Math.min(370, Math.max(48, x(point.timestamp) - 80)) : 0;
  return (
    <Card className="observability-metric-card">
      <CardBody>
        <Title headingLevel="h3" size="md" className="observability-metric-card__title">
          {metric.label}
          {metric.unit && <span className="observability-metric-card__unit"> ({metric.unit})</span>}
        </Title>
        {metric.status === 'ok' && last ? (
          <>
            <svg
              data-start={start}
              data-end={end}
              viewBox="0 0 580 190"
              role="img"
              aria-label={`${metric.label} over time`}
              className="observability-chart"
              onMouseLeave={() => setHover(null)}
              onMouseMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const cursor = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 580;
                setHover(
                  Math.max(0, Math.min(points.length - 1, Math.round(((cursor - 48) / 506) * (points.length - 1)))),
                );
              }}
            >
              <defs>
                <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.26" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.03" />
                </linearGradient>
              </defs>
              {ticks.map((f) => (
                <g key={f}>
                  <line x1="48" x2="554" y1={y(ceiling * f)} y2={y(ceiling * f)} stroke="currentColor" opacity="0.1" />
                  <text x="42" y={y(ceiling * f) + 4} textAnchor="end" fontSize="10" fill="currentColor">
                    {tickLabel(ceiling * f)}
                  </text>
                </g>
              ))}
              <path d={`${path} L554 156 L48 156 Z`} fill={`url(#fill-${id})`} />
              <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
              {metric.key === 'gpu' && (
                <line x1="48" x2="554" y1={y(90)} y2={y(90)} stroke="#f0ab00" strokeDasharray="4 3" />
              )}
              {ticks.map((f) => (
                <text
                  key={f}
                  x={48 + f * 506}
                  y="179"
                  textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
                  fontSize="10"
                  fill="currentColor"
                >
                  {new Date((start + f * (end - start)) * 1000).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </text>
              ))}
              {point && (
                <g>
                  <line x1={x(point.timestamp)} x2={x(point.timestamp)} y1="24" y2="156" stroke={color} opacity="0.5" />
                  <circle cx={x(point.timestamp)} cy={y(point.value)} r="3" fill={color} />
                  <rect
                    x={readoutX}
                    y="0"
                    width="185"
                    height="22"
                    rx="3"
                    fill="var(--pf-t--global--background--color--primary--default)"
                    stroke={color}
                  />
                  <text x={readoutX + 7} y="15" fontSize="11" fill="currentColor">
                    {new Date(point.timestamp * 1000).toLocaleTimeString()} · {format(point.value)} {metric.unit}
                  </text>
                </g>
              )}
            </svg>
            <p className="observability-chart-caption">
              Latest: {format(last.value)} {metric.unit} · {new Date(last.timestamp * 1000).toLocaleTimeString()}
            </p>
          </>
        ) : (
          <p className="observability-empty-metric">{metric.message ?? 'No data available.'}</p>
        )}
      </CardBody>
    </Card>
  );
}

/** The kinds of tokens the usage chart stacks, in order, with their colours. */
const tokenKinds = [
  { key: 'input', label: 'Uncached input', color: '#0066cc' },
  { key: 'output', label: 'Output', color: '#3e8635' },
  { key: 'cached', label: 'Cached input', color: '#6b46c1' },
] as const;

const USAGE_ROW = 34;
const USAGE_LABEL_WIDTH = 170;
const USAGE_BAR_WIDTH = 400;

/** Each organization's tokens as one horizontal stacked bar, names on the left so they never overlap. */
function UsageChart({ usage }: { usage: ReturnType<typeof tenantUsage> }) {
  const totals = usage.map((t) => t.input + t.output + t.cached);
  const ceiling = niceCeiling(Math.max(0, ...totals));
  const height = usage.length * USAGE_ROW + 30;
  const bar = (n: number) => (n / ceiling) * USAGE_BAR_WIDTH;
  return (
    <>
      <svg
        viewBox={`0 0 ${USAGE_LABEL_WIDTH + USAGE_BAR_WIDTH + 60} ${height}`}
        role="img"
        aria-label="Token consumption by organization"
        className="observability-usage-chart"
        data-total={totals.reduce((n, t) => n + t, 0)}
      >
        {ticks.map((f) => (
          <g key={f}>
            <line
              x1={USAGE_LABEL_WIDTH + f * USAGE_BAR_WIDTH}
              x2={USAGE_LABEL_WIDTH + f * USAGE_BAR_WIDTH}
              y1="0"
              y2={height - 22}
              stroke="currentColor"
              opacity="0.1"
            />
            <text
              x={USAGE_LABEL_WIDTH + f * USAGE_BAR_WIDTH}
              y={height - 6}
              textAnchor="middle"
              fontSize="11"
              fill="currentColor"
            >
              {tickLabel(ceiling * f)}
            </text>
          </g>
        ))}
        {usage.map((t, i) => {
          const top = i * USAGE_ROW + 6;
          let left = USAGE_LABEL_WIDTH;
          return (
            <g key={t.id}>
              <text x={USAGE_LABEL_WIDTH - 10} y={top + 16} textAnchor="end" fontSize="12" fill="currentColor">
                {t.name}
              </text>
              {tokenKinds.map((kind) => {
                const width = bar(t[kind.key]);
                const rect = (
                  <rect
                    key={kind.key}
                    data-organization={t.id}
                    data-kind={kind.key}
                    x={left}
                    y={top}
                    width={width}
                    height={USAGE_ROW - 12}
                    fill={kind.color}
                    opacity="0.75"
                  />
                );
                left += width;
                return rect;
              })}
              <text x={left + 6} y={top + 16} fontSize="11" fill="currentColor">
                {tickLabel(totals[i])}
              </text>
              <title>
                {t.name}: {t.input.toLocaleString()} uncached input, {t.output.toLocaleString()} output,{' '}
                {t.cached.toLocaleString()} cached input
              </title>
            </g>
          );
        })}
      </svg>
      <ul className="observability-legend" aria-label="Token kinds">
        {tokenKinds.map((kind) => (
          <li key={kind.key}>
            <span className="observability-legend__swatch" style={{ background: kind.color }} />
            {kind.label}
          </li>
        ))}
      </ul>
    </>
  );
}

type Props = {
  clusters: GridCluster[];
  models: ManagedModel[];
  modelsError?: string;
  organizations: Organization[];
  organizationsError?: string;
  metrics: GridMetric[];
  loading: boolean;
  error?: string;
  simulated: boolean;
  range: GridRange;
};

/** The Monitoring page's Clusters, Models, and Usage tabs. */
export function ObservabilityPanel({
  clusters,
  models,
  modelsError,
  organizations,
  organizationsError,
  metrics,
  loading,
  error,
  simulated,
  range,
}: Props) {
  const [tab, setTab] = useState<string | number>('cluster');
  const [model, setModel] = useState('all');
  const value = (key: string) => {
    const m = metrics.find((m) => m.key === key);
    const points = m?.status === 'ok' ? m.points : [];
    return points.length ? points.reduce((n, p) => n + p.value, 0) / points.length : undefined;
  };
  const gpu = value('gpu');
  const requestTotal = total(metrics.find((m) => m.key === 'requests'));
  const errorTotal = total(metrics.find((m) => m.key === 'errors'));
  const success =
    requestTotal !== undefined && requestTotal > 0 && errorTotal !== undefined
      ? Math.max(0, 100 * (1 - errorTotal / requestTotal))
      : undefined;
  const metricText = (v: number | undefined, fractionDigits = 1) =>
    v === undefined ? EMPTY_VALUE : v.toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
  const charts = (keys: string[]) => (
    <div className="observability-chart-grid observability-chart-grid--2col">
      {keys.map((key) => {
        const metric = metrics.find((m) => m.key === key);
        return metric ? <MetricChart key={key} metric={metric} /> : null;
      })}
    </div>
  );
  const relevantModels = models.filter(
    (m) => m.locations.length === 0 || clusters.some((c) => c.location && m.locations.includes(c.location)),
  );
  if (model !== 'all' && !relevantModels.some((m) => modelKey(m) === model)) {
    setModel('all');
  }
  const modelOptions = [
    { value: 'all', label: 'All models' },
    ...relevantModels.map((m) => ({ value: modelKey(m), label: m.displayName ?? m.name })),
  ];
  const visibleModels = relevantModels.filter((m) => model === 'all' || modelKey(m) === model);
  const modelSeries = modelMetrics(visibleModels, metrics, simulated);
  const usage = tenantUsage(metrics, organizations);
  const usageTotal = usage.reduce((n, t) => n + t.input + t.output + t.cached, 0);

  const usageTab = () => {
    if (organizationsError) {
      return (
        <Alert isInline variant="warning" title="Organization data unavailable">
          {organizationsError}
        </Alert>
      );
    }
    if (!organizations.length) {
      return (
        <Alert isInline variant="info" title="No organizations">
          Create organizations to see their simulated consumption.
        </Alert>
      );
    }
    if (!simulated || requestTotal === undefined) {
      return (
        <Alert isInline variant="info" title="Organization usage unavailable">
          Organization token telemetry is not configured for this source or selection.
        </Alert>
      );
    }
    return (
      <>
        <Section title="Token consumption by organization">
          <Card className="observability-metric-card">
            <CardBody>
              <p className="observability-consumption-total">
                {usageTotal.toLocaleString()} tokens in the last {range}
              </p>
              <UsageChart usage={usage} />
            </CardBody>
          </Card>
        </Section>
        <Section title="Usage by organization">
          <Table aria-label="Organization usage" variant="compact">
            <Thead>
              <Tr>
                <Th>Organization</Th>
                <Th className="console-number">Uncached input tokens</Th>
                <Th className="console-number">Output tokens</Th>
                <Th className="console-number">Cached input tokens</Th>
              </Tr>
            </Thead>
            <Tbody>
              {usage.map((t) => (
                <Tr key={t.id}>
                  <Td dataLabel="Organization">
                    <Link to={`/organizations/${encodeURIComponent(t.id)}`}>{t.name}</Link>
                  </Td>
                  <Td dataLabel="Uncached input tokens" className="console-number">
                    {t.input.toLocaleString()}
                  </Td>
                  <Td dataLabel="Output tokens" className="console-number">
                    {t.output.toLocaleString()}
                  </Td>
                  <Td dataLabel="Cached input tokens" className="console-number">
                    {t.cached.toLocaleString()}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Section>
      </>
    );
  };

  return (
    <>
      <Tabs activeKey={tab} onSelect={(_, key) => setTab(key)}>
        <Tab eventKey="cluster" title={<TabTitleText>Clusters</TabTitleText>} />
        <Tab eventKey="models" title={<TabTitleText>Models</TabTitleText>} />
        <Tab eventKey="usage" title={<TabTitleText>Usage</TabTitleText>} />
      </Tabs>
      <div className="observability-dashboard">
        {loading && <Spinner size="lg" aria-label="Loading metrics" />}
        {error && (
          <Alert isInline variant="danger" title="Monitoring unavailable">
            {error}
          </Alert>
        )}
        {tab === 'cluster' && (
          <>
            <Section
              title="Overview"
              help={`Requests, GPU use and success rate cover the last ${range}. Ready clusters is the current state.`}
            >
              <div className="observability-stat-row">
                <Stat
                  label="Ready clusters"
                  value={`${clusters.filter((c) => c.status === 'Ready').length}/${clusters.length}`}
                />
                <Stat label="Requests" value={metricText(requestTotal, 0)} />
                <Stat
                  label="Average GPU utilization"
                  value={metricText(gpu)}
                  unit="%"
                  warn={gpu !== undefined && gpu > 85}
                />
                <Stat label="Request success rate" value={metricText(success)} unit="%" />
              </div>
            </Section>
            <Section title="Cluster resources">{charts(['gpu', 'requests'])}</Section>
            <Section title="Gateway performance">{charts(['errors', 'latency'])}</Section>
            <Section title="Clusters">
              <Table aria-label="Clusters" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Cluster</Th>
                    <Th>Site</Th>
                    <Th>Location</Th>
                    <Th>Status</Th>
                    <Th>Provisioning</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {clusters.map((c) => (
                    <Tr key={c.name}>
                      <Td dataLabel="Cluster">
                        <Link to={`/ai-grid?cluster=${encodeURIComponent(c.name)}`}>{c.name}</Link>
                      </Td>
                      <Td dataLabel="Site">{c.siteName ?? c.site ?? EMPTY_VALUE}</Td>
                      <Td dataLabel="Location">{c.location ?? EMPTY_VALUE}</Td>
                      <Td dataLabel="Status">
                        <StatusLabel isCompact status={c.status} />
                      </Td>
                      <Td dataLabel="Provisioning">
                        <StatusLabel isCompact status={c.provisioningStatus} />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              {!clusters.length && <p>No enrolled clusters match this selection.</p>}
            </Section>
          </>
        )}
        {tab === 'models' && (
          <>
            {modelsError && (
              <Alert isInline variant="warning" title="Models unavailable">
                {modelsError}
              </Alert>
            )}
            <Flex
              className="observability-model-filter"
              alignItems={{ default: 'alignItemsCenter' }}
              spaceItems={{ default: 'spaceItemsSm' }}
            >
              <label htmlFor="observability-model">Model deployment</label>
              <div className="observability-model-filter__select">
                <TypeaheadSelect
                  id="observability-model"
                  aria-label="Select model deployment"
                  value={model}
                  options={modelOptions}
                  onChange={setModel}
                />
              </div>
            </Flex>
            <Section
              title="Model deployments"
              help="Target sites are the sites of the clusters each model's placement chose; they don't confirm the model is serving there."
            >
              <Table aria-label="Model deployments" variant="compact">
                <Thead>
                  <Tr>
                    <Th>Model deployment</Th>
                    <Th>Model</Th>
                    <Th>Target sites</Th>
                    <Th className="console-number">Replicas</Th>
                    <Th>Status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {visibleModels.map((m) => (
                    <Tr key={modelKey(m)}>
                      <Td dataLabel="Model deployment">
                        <Link to={modelPath(m)}>{m.displayName ?? m.name}</Link>
                      </Td>
                      <Td dataLabel="Model" modifier="breakWord">
                        {m.modelName ?? m.modelRef.name}
                      </Td>
                      <Td dataLabel="Target sites">
                        {[
                          ...new Set(
                            clusters
                              .filter((c) => c.location && m.locations.includes(c.location))
                              .map((c) => c.siteName ?? c.site ?? c.name),
                          ),
                        ].join(', ') || EMPTY_VALUE}
                      </Td>
                      <Td dataLabel="Replicas" className="console-number">
                        {m.replicas ?? EMPTY_VALUE}
                      </Td>
                      <Td dataLabel="Status">
                        <StatusLabel isCompact status={m.phase ?? 'Pending'} />
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
              {!visibleModels.length && <p>No model deployments match this selection.</p>}
            </Section>
            <Section title="Performance">
              <div className="observability-chart-grid observability-chart-grid--2col">
                {modelSeries.map((m) => (
                  <MetricChart key={m.key} metric={m} />
                ))}
              </div>
            </Section>
          </>
        )}
        {tab === 'usage' && usageTab()}
      </div>
    </>
  );
}
