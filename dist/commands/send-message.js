import { optionalString, requirePositional } from '../command.js';
import { printJson } from '../format.js';
import { parseThreadLink, resolveConversation, threadTsIn } from '../resolve.js';
import { SlackApiError, UsageError } from '../slack-client.js';
async function permalinkFor(client, channel, ts) {
    try {
        const data = await client.call('chat.getPermalink', { channel, message_ts: ts });
        return data.permalink;
    }
    catch (error) {
        // The message is already sent; failing here would invite a duplicate retry.
        if (error instanceof SlackApiError)
            return undefined;
        throw error;
    }
}
async function postMessage(client, channel, text, threadTs) {
    try {
        return await client.call('chat.postMessage', { channel, text, thread_ts: threadTs });
    }
    catch (error) {
        if (error instanceof SlackApiError && error.outcomeUnknown) {
            const code = `${error.code}. The message may have been sent; check the conversation before retrying`;
            throw new SlackApiError(error.method, code, { outcomeUnknown: true });
        }
        throw error;
    }
}
export const sendMessageCommand = {
    name: 'send-message',
    summary: 'Send a message as yourself to a channel, DM or thread',
    usage: 'slack-hop send-message <channel> <text...> --workspace <name> [--thread <ts or message-link>]',
    details: [
        '<channel> can be #name, a channel ID, @handle or a user ID (for a DM), or a message link to',
        'reply in that message\'s thread. Everything after <channel> is the message; quote it to be safe,',
        'and put -- before text that starts with a dash.',
        'The message is posted as you. Slack formatting (mrkdwn) works. To mention someone, write',
        '<@USER_ID> (find-user shows IDs); a plain @name does not notify them.',
        'Slack has no tables: put a table inside a ``` code block so its columns line up.',
        'Options:',
        '  --thread   Reply in a thread: the parent ts or a link to any message in it',
        'Examples:',
        '  slack-hop send-message general "Deploy is done" --workspace client-b',
        '  slack-hop send-message @jane "Got it, thanks" --workspace client-b',
        '  slack-hop send-message general "On it" --workspace client-b --thread 1696000000.123456',
        '  slack-hop send-message --workspace client-b general -- "-1 from me"',
    ],
    options: {
        thread: { type: 'string' },
    },
    needsWorkspace: true,
    async run({ client, positionals, options, json }) {
        const target = requirePositional(positionals, 0, 'channel');
        const text = positionals.slice(1).join(' ');
        if (!text.trim())
            throw new UsageError('Missing <text>.');
        const channel = await resolveConversation(client, target);
        const threadOption = optionalString(options.thread);
        const threadTs = threadOption ? threadTsIn(channel, threadOption) : parseThreadLink(target)?.ts;
        const posted = await postMessage(client, channel, text, threadTs);
        const permalink = await permalinkFor(client, posted.channel, posted.ts);
        if (json) {
            printJson({ channel: posted.channel, ts: posted.ts, permalink });
            return;
        }
        console.log(`Sent to ${posted.channel} (ts ${posted.ts})${permalink ? `: ${permalink}` : '.'}`);
    },
};
