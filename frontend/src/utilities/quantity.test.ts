import { describe, expect, it } from 'vitest';
import { formatCores, formatGiB, parseQuantity } from './quantity';

describe('parseQuantity', () => {
  it.each([
    ['68', 68],
    ['77500m', 77.5],
    ['1.5', 1.5],
    ['2k', 2000],
    ['273509824Ki', 273509824 * 1024],
    ['1572864Mi', 1572864 * 2 ** 20],
    ['3600Gi', 3600 * 2 ** 30],
    [' 16 ', 16],
  ])('%s is %d', (quantity, want) => {
    expect(parseQuantity(quantity)).toBe(want);
  });

  it.each([undefined, '', 'abc', '1e3', '-1', '12Xi'])('%s is unknown', (quantity) => {
    expect(parseQuantity(quantity)).toBeUndefined();
  });
});

describe('formatCores', () => {
  it('reads whole and milli cores', () => {
    expect(formatCores('68')).toBe('68 cores');
    expect(formatCores('77500m')).toBe('77.5 cores');
    expect(formatCores('1')).toBe('1 core');
    expect(formatCores('bad')).toBeUndefined();
  });
});

describe('formatGiB', () => {
  it('rounds to whole GiB from 10 up and keeps one decimal below', () => {
    expect(formatGiB('273509824Ki')).toBe('261 GiB');
    expect(formatGiB('1572864Mi')).toBe('1536 GiB');
    expect(formatGiB('1536Mi')).toBe('1.5 GiB');
    expect(formatGiB(undefined)).toBeUndefined();
  });
});
