import { describe, expect, it } from 'vitest';
import { modelServerOf, modelServers } from './modelServers';

describe('modelServerOf', () => {
  it('names the CPU server by its preset', () => {
    expect(modelServerOf(['v3-6-0-kserve-config-llm-template-cpu'])?.id).toBe('vllm-cpu');
  });

  it("names the GPU server for no presets, KServe's default", () => {
    expect(modelServerOf([])?.id).toBe('vllm-gpu');
    expect(modelServerOf(undefined)?.id).toBe('vllm-gpu');
  });

  it('names no server for presets the console does not offer', () => {
    expect(modelServerOf(['custom-preset'])).toBeUndefined();
    expect(modelServerOf(['v3-6-0-kserve-config-llm-template-cpu', 'extra'])).toBeUndefined();
  });

  it('offers CPU first, and only the GPU server uses GPUs', () => {
    expect(modelServers.map((s) => [s.id, s.usesGpus])).toEqual([
      ['vllm-cpu', false],
      ['vllm-gpu', true],
    ]);
  });
});
