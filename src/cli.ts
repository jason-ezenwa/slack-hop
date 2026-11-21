import { parseArgs } from 'node:util';
import { COMMON_OPTIONS, JSON_HELP, WORKSPACE_HELP, WORKSPACE_OPTION } from './commands/command-constants.js';
import type { Command } from './commands/command-types.js';
import { optionalString } from './commands/command.js';
import { findUserCommand } from './commands/find-user.js';
import { listChannelsCommand } from './commands/list-channels.js';
import { readChannelCommand } from './commands/read-channel.js';
import { readThreadCommand } from './commands/read-thread.js';
import { searchCommand } from './commands/search.js';
import { sendMessageCommand } from './commands/send-message.js';
import { workspacesCommand } from './commands/workspaces.js';
import { resolveToken, SlackApiError, SlackClient, UsageError } from './slack/slack-client.js';
import type { Env } from './types.js';

const COMMANDS: Command[] = [
  workspacesCommand,
  listChannelsCommand,
  readChannelCommand,
  readThreadCommand,
  searchCommand,
  sendMessageCommand,
  findUserCommand,
];

function mainHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));

  return [
    'slack-hop: read and post in Slack workspaces as yourself, one token per workspace.',
    '',
    'Usage: slack-hop <command> [arguments] --workspace <name> [--json]',
    '',
    'Commands:',
    ...COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`),
    '',
    'Global options:',
    ...WORKSPACE_HELP,
    JSON_HELP,
    '  -h, --help               Show help; `slack-hop <command> --help` for a command',
    '',
    'Run `slack-hop workspaces` to see which workspaces are configured.',
  ].join('\n');
}

function commandHelp(command: Command): string {
  return [
    `${command.summary}.`,
    '',
    `Usage: ${command.usage}`,
    '',
    ...command.details,
    '',
    'Global options:',
    ...(command.needsWorkspace ? WORKSPACE_HELP : []),
    JSON_HELP,
  ].join('\n');
}

// parseArgs reports unknown flags and missing values as TypeErrors with an ERR_PARSE_ARGS_* code.
function isParseArgsError(error: unknown): error is TypeError {
  return error instanceof TypeError && String((error as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS');
}

export async function main(argv: string[], env: Env): Promise<number> {
  const [name, ...rest] = argv;

  if (!name || name === '--help' || name === '-h' || name === 'help') {
    console.log(mainHelp());
    return 0;
  }

  const command = COMMANDS.find((candidate) => candidate.name === name);

  if (!command) {
    console.error(`Unknown command "${name}".\n\n${mainHelp()}`);
    return 2;
  }

  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...COMMON_OPTIONS, ...(command.needsWorkspace ? WORKSPACE_OPTION : {}), ...command.options },
      allowPositionals: true,
      strict: true,
    });

    if (values.help) {
      console.log(commandHelp(command));
      return 0;
    }

    const base = { positionals, options: values, json: values.json === true, env };

    if (!command.needsWorkspace) {
      await command.run(base);
      return 0;
    }

    const workspace = optionalString(values.workspace);
    if (!workspace) throw new UsageError('Missing --workspace <name>. Run `slack-hop workspaces` to list them.');
    const client = new SlackClient(resolveToken(workspace, env));
    await command.run({ ...base, client, workspace });
    return 0;
  } catch (error) {
    if (error instanceof UsageError || isParseArgsError(error)) {
      console.error(`${error.message}\n\nUsage: ${command.usage}\nRun \`slack-hop ${command.name} --help\` for details.`);
      return 2;
    }

    if (error instanceof SlackApiError) {
      console.error(error.message);
      return 1;
    }

    throw error;
  }
}
