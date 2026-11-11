import {
  MODEL_CAPABILITIES,
  capabilitiesOf,
  capabilityColor,
  includesCapability,
  isWellFormedCapabilities,
  sameCapabilities,
} from './modelCapabilities';

/** A model's annotations with the capabilities annotation written as `raw`. */
const withRaw = (raw: string) => ({ 'openshift.io/display-name': 'Widget', [MODEL_CAPABILITIES]: raw });

describe('capabilitiesOf', () => {
  it('reads the values as written, in their order', () => {
    expect(capabilitiesOf(withRaw('["Text completion","Vision","my-tag"]'))).toEqual([
      'Text completion',
      'Vision',
      'my-tag',
    ]);
  });

  it('reads a model without the annotation as none', () => {
    expect(capabilitiesOf({})).toEqual([]);
  });

  it('keeps each value once, trimmed and in any case, as first written', () => {
    expect(capabilitiesOf(withRaw('["Chat"," chat ","Vision","CHAT","vision"]'))).toEqual(['Chat', 'Vision']);
  });

  it.each(['not json', '"Chat"', '{"Chat":true}', '["Chat", 1]', 'null', ''])(
    'reads the malformed annotation %j as none, without throwing',
    (raw) => {
      expect(capabilitiesOf(withRaw(raw))).toEqual([]);
    },
  );
});

describe('includesCapability', () => {
  it.each([
    [['Text completion'], ' TEXT COMPLETION ', true],
    [['chat'], 'Chat', true],
    [['Chat'], 'Text completion', false],
    // Matched trimmed and in any case only: another spelling is another value.
    [['text_completion'], 'Text completion', false],
  ])('finds in %j the value %j: %s', (values, value, found) => {
    expect(includesCapability(values, value)).toBe(found);
  });
});

describe('sameCapabilities', () => {
  it.each([
    [[], [], true],
    [['Chat', 'Vision'], ['vision', ' CHAT'], true],
    [['Chat'], [], false],
    [['Chat'], ['Chat', 'Vision'], false],
    [['Chat'], ['Text completion'], false],
  ])('%j and %j: %s', (a, b, same) => {
    expect(sameCapabilities(a, b)).toBe(same);
  });
});

describe('capabilityColor', () => {
  it.each([
    ['Vision', 'blue'],
    ['Transcription', 'orange'],
    ['Chat', 'purple'],
    [' text COMPLETION ', 'teal'],
    ['my-tag', 'grey'],
    // Names an object has from its prototype are values like any other.
    ['constructor', 'grey'],
    ['__proto__', 'grey'],
    ['toString', 'grey'],
  ])('colors %j %s', (value, color) => {
    expect(capabilityColor(value)).toBe(color);
  });
});

describe('isWellFormedCapabilities', () => {
  it.each(['[]', '["Chat"]', '["Text completion","Vision"]', '["custom value"]'])('accepts %j', (raw) => {
    expect(isWellFormedCapabilities(raw)).toBe(true);
  });

  it.each(['not json', '"Chat"', '{"Chat":true}', '["Chat", 1]', 'null', '', '["Chat",""]', '["  "]'])(
    'refuses %j, as the backend does',
    (raw) => {
      expect(isWellFormedCapabilities(raw)).toBe(false);
    },
  );
});
