import { limitHelp, optionalString, parseLimit } from '../command.js';
import { printList } from '../format.js';
import { UsageError } from '../slack-client.js';
import { personLabel } from '../person.js';
import { UserNames } from '../user-names.js';
const LIMIT = { fallback: 200, max: 1000 };
const TYPE_NAMES = new Map([
    ['public', 'public_channel'],
    ['private', 'private_channel'],
    ['dm', 'im'],
    ['group-dm', 'mpim'],
]);
function parseTypes(value) {
    const names = (value ?? 'public,private').split(',').map((name) => name.trim());
    return names
        .map((name) => {
        const type = TYPE_NAMES.get(name);
        if (!type)
            throw new UsageError(`Unknown type "${name}". Use: ${[...TYPE_NAMES.keys()].join(', ')}.`);
        return type;
    })
        .join(',');
}
export const listChannelsCommand = {
    name: 'list-channels',
    summary: 'List conversations you are a member of',
    usage: 'slack-hop list-channels --workspace <name> [--types public,private,dm,group-dm] [--limit 200]',
    details: [
        'Options:',
        '  --types   Comma-separated: public, private, dm, group-dm (default: public,private)',
        limitHelp('conversations', LIMIT),
        'Example:',
        '  slack-hop list-channels --workspace client-b --types dm',
    ],
    options: {
        types: { type: 'string' },
        limit: { type: 'string' },
    },
    needsWorkspace: true,
    async run({ client, options, json }) {
        const conversations = await client.paginate('users.conversations', 'channels', { types: parseTypes(optionalString(options.types)), exclude_archived: true }, parseLimit(options.limit, LIMIT));
        const names = new UserNames(client);
        // DMs are labelled by person. Listing everyone once beats a users.info call per DM, which hits rate limits.
        if (!json && conversations.some((conversation) => conversation.is_im))
            await names.loadAll();
        await printList(conversations, json, 'No conversations.', async (conversation) => {
            const label = conversation.is_im
                ? `DM with ${conversation.user ? personLabel(await names.get(conversation.user)) : 'unknown'}`
                : `#${conversation.name ?? conversation.id}${conversation.is_private && !conversation.is_mpim ? ' (private)' : ''}`;
            return `${conversation.id}  ${label}`;
        });
    },
};
