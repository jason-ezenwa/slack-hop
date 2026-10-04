import { FULL_HELP, FULL_OPTION, limitHelp, optionalString, parseLimit, requirePositional, type Command, wantsFull } from '../command.js';
import { formatMessage, printList } from '../format.js';
import { resolveConversation, toSlackTs } from '../resolve.js';
import type { SlackMessage } from '../slack-types.js';
import { UserNames } from '../user-names.js';

const LIMIT = { fallback: 20, max: 1000 };

export const readChannelCommand: Command = {
  name: 'read-channel',
  summary: 'Read recent messages from a channel or DM',
  usage: 'slack-hop read-channel <channel> --workspace <name> [--limit 20] [--since <time>] [--until <time>]',
  details: [
    '<channel> can be #name, a channel ID, a message link, @handle or a user ID (for a DM).',
    'Shows the most recent messages in the range, printed oldest first. Thread replies are not',
    'included; use read-thread for those. With --since, you get the latest <limit> messages after',
    'that time, so raise --limit to see everything since then.',
    'Options:',
    limitHelp('messages', LIMIT),
    '  --since   Only messages after this time: a date like 2026-10-01 or a Slack ts',
    '  --until   Only messages before this time',
    FULL_HELP,
    'Examples:',
    '  slack-hop read-channel general --workspace client-b',
    '  slack-hop read-channel @jane --workspace client-b --since 2026-10-01',
  ],
  options: {
    limit: { type: 'string' },
    since: { type: 'string' },
    until: { type: 'string' },
    ...FULL_OPTION,
  },
  needsWorkspace: true,
  async run({ client, positionals, options, json }) {
    const since = optionalString(options.since);
    const until = optionalString(options.until);
    const params = {
      oldest: since ? toSlackTs(since) : undefined,
      latest: until ? toSlackTs(until) : undefined,
    };
    const limit = parseLimit(options.limit, LIMIT);
    const channel = await resolveConversation(client, requirePositional(positionals, 0, 'channel'));

    const messages = await client.paginate<SlackMessage>('conversations.history', 'messages', { channel, ...params }, limit);
    const names = new UserNames(client);
    await printList(messages.reverse(), json, 'No messages.', (message) =>
      formatMessage(message, names, wantsFull(options)),
    );
  },
};
