import { FULL_HELP, FULL_OPTION, limitHelp, parseLimit, requirePositional, wantsFull } from '../command.js';
import { formatTs, messageAuthor, messageBody, printList } from '../format.js';
import { personLabel } from '../person.js';
import { UserNames } from '../user-names.js';
const LIMIT = { fallback: 20, max: 100 };
// Where a match was posted: "#general", or "DM with Ayomide (@ayomide)" so DMs can be told apart.
async function matchLocation(match, names) {
    const channel = match.channel;
    if (!channel)
        return 'unknown';
    if (!channel.is_im)
        return `#${channel.name ?? channel.id}`;
    const partner = await names.dmPartner(channel.id);
    return partner ? `DM with ${personLabel(partner)}` : `DM ${channel.id}`;
}
export const searchCommand = {
    name: 'search',
    summary: 'Search messages using Slack search syntax',
    usage: 'slack-hop search <query> --workspace <name> [--limit 20]',
    details: [
        'Supports Slack modifiers such as in:#channel, from:@handle, before:2026-10-01, after:2026-09-01.',
        'Results are newest first.',
        'Options:',
        limitHelp('results', LIMIT),
        FULL_HELP,
        'Example:',
        '  slack-hop search "deploy in:#eng after:2026-09-30" --workspace client-b',
    ],
    options: {
        limit: { type: 'string' },
        ...FULL_OPTION,
    },
    needsWorkspace: true,
    async run({ client, positionals, options, json }) {
        requirePositional(positionals, 0, 'query');
        const data = await client.call('search.messages', {
            query: positionals.join(' '),
            count: parseLimit(options.limit, LIMIT),
            sort: 'timestamp',
            sort_dir: 'desc',
        });
        const names = new UserNames(client);
        await printList(data.messages.matches, json, 'No matches.', async (match) => {
            const where = await matchLocation(match, names);
            const header = `[${formatTs(match.ts)}] ${where} · ${await messageAuthor(match, names)}`;
            const body = await messageBody(match, names, wantsFull(options));
            return `${header}: ${body}\n    (${match.permalink})`;
        });
    },
};
