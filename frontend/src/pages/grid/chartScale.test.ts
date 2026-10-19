import { niceCeiling, tickLabel } from './chartScale';

describe('niceCeiling', () => {
  it.each([
    [564.8, 600],
    [10494.1, 12000],
    [106_800_000, 120_000_000],
    [9, 10],
    [0.37, 0.4],
    [100, 100],
    [0, 4],
  ])('fits %d under %d, in round steps', (max, ceiling) => {
    expect(niceCeiling(max)).toBeCloseTo(ceiling);
    expect(niceCeiling(max)).toBeGreaterThanOrEqual(max);
  });
});

it.each([
  [0, '0'],
  [2500, '2,500'],
  [15000, '15k'],
  [1_500_000, '1.5M'],
  [0.25, '0.25'],
])('labels %d as %s', (value, label) => expect(tickLabel(value)).toBe(label));
