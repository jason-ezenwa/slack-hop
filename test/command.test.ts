import { describe, expect, it } from 'vitest';
import { parseLimit } from '../src/command.js';
import { UsageError } from '../src/slack-client.js';

describe('parseLimit', () => {
  const spec = { fallback: 20, max: 100 };

  it('uses the default when --limit is not given', () => {
    expect(parseLimit(undefined, spec)).toBe(20);
  });

  it('accepts whole numbers within range', () => {
    expect(parseLimit('1', spec)).toBe(1);
    expect(parseLimit('100', spec)).toBe(100);
  });

  it.each(['0', '101', '2.5', 'ten', ''])('rejects %j', (value) => {
    expect(() => parseLimit(value, spec)).toThrow(UsageError);
  });
});
