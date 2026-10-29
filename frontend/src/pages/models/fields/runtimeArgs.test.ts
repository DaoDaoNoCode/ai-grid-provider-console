import { filterRuntimeArgsForContainer, runtimeArgsOf, withRuntimeArgs } from './runtimeArgs';

describe('filterRuntimeArgsForContainer', () => {
  it('drops blank and comment lines, and trims only the space around each line', () => {
    expect(
      filterRuntimeArgsForContainer([
        '  --enforce-eager ',
        '   ',
        '  # a comment, indented',
        '--served-model-name "my model"',
        "--chat-template ' padded '",
      ]),
    ).toEqual(['--enforce-eager', '--served-model-name "my model"', "--chat-template ' padded '"]);
  });

  it('keeps quoted values, spaces inside them included, through a save and a reload', () => {
    const args = filterRuntimeArgsForContainer(['--served-model-name "my  model" ', ' --enforce-eager']);
    expect(runtimeArgsOf(withRuntimeArgs([], args))).toEqual(args);
  });
});

describe('runtime arguments in env', () => {
  it('reads and replaces VLLM_ADDITIONAL_ARGS, keeping every other variable', () => {
    const env = [
      { name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--max-model-len 4096 --enforce-eager -tp=2' },
    ];
    // One line per flag, its value kept with it.
    expect(runtimeArgsOf(env)).toEqual(['--max-model-len 4096', '--enforce-eager', '-tp=2']);
    expect(withRuntimeArgs(env, ['--enforce-eager'])).toEqual([
      { name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' },
      { name: 'VLLM_ADDITIONAL_ARGS', value: '--enforce-eager' },
    ]);
    // No arguments drop the variable, not the others.
    expect(withRuntimeArgs(env, [])).toEqual([{ name: 'VLLM_CPU_KVCACHE_SPACE', value: '8' }]);
    expect(runtimeArgsOf(undefined)).toEqual([]);
  });

  it('keeps quoted values whole, flag-like text and spacing included, so an edit round-trips them', () => {
    const value = `--served-model-name "alpha  --beta" --chat-template '{{ x }} --y' --enforce-eager`;
    const args = runtimeArgsOf([{ name: 'VLLM_ADDITIONAL_ARGS', value }]);
    expect(args).toEqual([`--served-model-name "alpha  --beta"`, `--chat-template '{{ x }} --y'`, '--enforce-eager']);
    // Joined again the way the wizard joins its lines, the value is unchanged.
    expect(withRuntimeArgs([], args)).toEqual([{ name: 'VLLM_ADDITIONAL_ARGS', value }]);
  });
});
