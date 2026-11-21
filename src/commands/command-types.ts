import type { ParseArgsConfig } from 'node:util';
import type { SlackClient } from '../slack/slack-client.js';
import type { Env } from '../types.js';

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

export type LimitSpec = { fallback: number; max: number };

export type WorkspaceStatus =
  | { workspace: string; status: 'ok'; team: string; user: string; url: string }
  | { workspace: string; status: 'rejected'; error: string };
