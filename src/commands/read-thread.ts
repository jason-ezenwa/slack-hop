import { FULL_HELP, FULL_OPTION, limitHelp, parseLimit, requirePositional, type Command, wantsFull } from '../command.js';
import { formatMessage, printList } from '../format.js';
import { parseThreadLink, resolveConversation, threadTsIn, type ThreadRef } from '../resolve.js';
import type { SlackClient } from '../slack-client.js';
import type { SlackMessage } from '../slack-types.js';
import { UserNames } from '../user-names.js';

const LIMIT = { fallback: 200, max: 1000 };

async function threadFrom(client: SlackClient, positionals: string[]): Promise<ThreadRef> {
  const first = requirePositional(positionals, 0, 'message-link or channel');
  const linked = parseThreadLink(first);
  if (linked) return linked;
  const channel = await resolveConversation(client, first);
  return { channel, ts: threadTsIn(channel, requirePositional(positionals, 1, 'ts')) };
}

export const readThreadCommand: Command = {
  name: 'read-thread',
  summary: 'Read a thread: the parent message and its replies',
  usage: 'slack-hop read-thread <message-link> --workspace <name>\n       slack-hop read-thread <channel> <ts> --workspace <name>',
  details: [
    'Pass a link to any message in the thread, or a channel plus the thread ts shown by read-channel.',
    'Options:',
    limitHelp('messages', LIMIT),
    FULL_HELP,
    'Examples:',
    '  slack-hop read-thread https://acme.slack.com/archives/C0123ABCD/p1696000000123456 --workspace client-b',
    '  slack-hop read-thread general 1696000000.123456 --workspace client-b',
  ],
  options: {
    limit: { type: 'string' },
    ...FULL_OPTION,
  },
  needsWorkspace: true,
  async run({ client, positionals, options, json }) {
    const limit = parseLimit(options.limit, LIMIT);
    const thread = await threadFrom(client, positionals);

    // Slack repeats the parent message at the top of every page, so keep each ts once.
    const seen = new Set<string>();
    const messages: SlackMessage[] = [];
    for await (const message of client.iterate<SlackMessage>('conversations.replies', 'messages', thread)) {
      if (seen.has(message.ts)) continue;
      seen.add(message.ts);
      messages.push(message);
      if (messages.length >= limit) break;
    }

    const names = new UserNames(client);
    await printList(messages, json, 'No messages.', (message) =>
      formatMessage(message, names, wantsFull(options)),
    );
  },
};
