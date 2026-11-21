import type { LimitSpec, OptionValues } from './command-types.js';
import { UsageError } from '../slack/slack-client.js';

export function wantsFull(options: OptionValues): boolean {
  return options.full === true;
}

export function limitHelp(noun: string, spec: LimitSpec): string {
  return `  --limit   Maximum ${noun}, 1-${spec.max} (default: ${spec.fallback})`;
}

export function parseLimit(value: string | boolean | undefined, spec: LimitSpec): number {
  if (value === undefined) return spec.fallback;
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1 || limit > spec.max) {
    throw new UsageError(`--limit must be a whole number from 1 to ${spec.max}.`);
  }

  return limit;
}

export function requirePositional(positionals: string[], index: number, name: string): string {
  const value = positionals[index];
  if (!value) throw new UsageError(`Missing <${name}>.`);
  return value;
}

export function optionalString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
