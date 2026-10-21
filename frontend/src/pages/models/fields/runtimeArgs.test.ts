import { runtimeArgsOf, withRuntimeArgs } from '../../../api/adapters';
import { filterRuntimeArgsForContainer } from './runtimeArgs';

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
