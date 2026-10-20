/** How many intervals a chart axis has (five ticks, from zero). */
export const AXIS_INTERVALS = 4;

/**
 * The axis's top for values up to `max`: AXIS_INTERVALS steps of a round size (1, 1.5, 2, 2.5,
 * 3, 4, 5, 6 or 8 times a power of ten), so every tick reads as a round number (0, 150, 300, ...)
 * instead of 564.8 or 10,494.1, without leaving much of the chart empty.
 */
export const niceCeiling = (max: number): number => {
  if (!(max > 0)) {
    return AXIS_INTERVALS;
  }
  const raw = max / AXIS_INTERVALS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => n * magnitude >= raw)! * magnitude;
  return step * AXIS_INTERVALS;
};

/** A tick's label: whole numbers grouped (1,000), short forms above ten thousand (12k, 1.5M, 2.4B). */
export const tickLabel = (value: number): string => {
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))}B`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 10_000) return `${Number((value / 1000).toFixed(1))}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
