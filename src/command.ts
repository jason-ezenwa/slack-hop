import type { ParseArgsConfig } from 'node:util';
import { UsageError, type Env, type SlackClient } from './slack-client.js';

export type OptionValues = Record<string, string | boolean | undefined>;

export type BaseContext = {
  positionals: string[];
  options: OptionValues;
  json: boolean;
  env: Env;
};

export type WorkspaceContext = BaseContext & {
  client: SlackClient;
  workspace: string;
};

type CommandInfo = {
  name: string;
  summary: string;
  usage: string;
  // Extra help lines shown by `slack-hop <command> --help`: options and examples.
  details: string[];
  options: NonNullable<ParseArgsConfig['options']>;
};

export type Command =
  | (CommandInfo & { needsWorkspace: true; run: (context: WorkspaceContext) => Promise<void> })
  | (CommandInfo & { needsWorkspace: false; run: (context: BaseContext) => Promise<void> });

// Shared by the commands that print messages.
export const FULL_OPTION = { full: { type: 'boolean' } } as const;
export const FULL_HELP = '  --full    Show whole messages (long ones are shortened by default)';

export function wantsFull(options: OptionValues): boolean {
  return options.full === true;
}

export type LimitSpec = { fallback: number; max: number };

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
