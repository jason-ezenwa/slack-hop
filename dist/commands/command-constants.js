export const WORKSPACE_OPTION = { workspace: { type: 'string', short: 'w' } };
export const COMMON_OPTIONS = {
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
};
export const WORKSPACE_HELP = [
    '  -w, --workspace <name>   Workspace to use. Its token is read from SLACK_TOKEN_<NAME>,',
    '                           e.g. --workspace client-b reads SLACK_TOKEN_CLIENT_B.',
];
export const JSON_HELP = '      --json               Print raw JSON instead of readable text';
// Shared by the commands that print messages.
export const FULL_OPTION = { full: { type: 'boolean' } };
export const FULL_HELP = '  --full    Show whole messages (long ones are shortened by default)';
export const TYPE_NAMES = new Map([
    ['public', 'public_channel'],
    ['private', 'private_channel'],
    ['dm', 'im'],
    ['group-dm', 'mpim'],
]);
