import { parseArgs } from 'node:util';
import { optionalString } from './command.js';
import { findUserCommand } from './commands/find-user.js';
import { listChannelsCommand } from './commands/list-channels.js';
import { readChannelCommand } from './commands/read-channel.js';
import { readThreadCommand } from './commands/read-thread.js';
import { searchCommand } from './commands/search.js';
import { sendMessageCommand } from './commands/send-message.js';
import { workspacesCommand } from './commands/workspaces.js';
import { resolveToken, SlackApiError, SlackClient, UsageError } from './slack-client.js';
const COMMANDS = [
    workspacesCommand,
    listChannelsCommand,
    readChannelCommand,
    readThreadCommand,
    searchCommand,
    sendMessageCommand,
    findUserCommand,
];
const WORKSPACE_OPTION = { workspace: { type: 'string', short: 'w' } };
const COMMON_OPTIONS = {
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
};
const WORKSPACE_HELP = [
    '  -w, --workspace <name>   Workspace to use. Its token is read from SLACK_TOKEN_<NAME>,',
    '                           e.g. --workspace client-b reads SLACK_TOKEN_CLIENT_B.',
];
const JSON_HELP = '      --json               Print raw JSON instead of readable text';
function mainHelp() {
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
function commandHelp(command) {
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
function isParseArgsError(error) {
    return error instanceof TypeError && String(error.code).startsWith('ERR_PARSE_ARGS');
}
export async function main(argv, env) {
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
        if (!workspace)
            throw new UsageError('Missing --workspace <name>. Run `slack-hop workspaces` to list them.');
        const client = new SlackClient(resolveToken(workspace, env));
        await command.run({ ...base, client, workspace });
        return 0;
    }
    catch (error) {
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
