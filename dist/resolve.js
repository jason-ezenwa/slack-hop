import { UsageError } from './slack-client.js';
// Slack IDs are uppercase letters and digits. Requiring a digit keeps all-caps names like GENERAL from looking like IDs.
const CONVERSATION_ID = /^[CGD](?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/;
const USER_ID = /^[UW](?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/;
const SLACK_TS = /^\d+\.\d+$/;
const PERMALINK = /\/archives\/(?<channel>[A-Z0-9]+)\/p(?<seconds>\d{10})(?<micros>\d{6})/;
// https://team.slack.com/archives/C123ABC/p1696000000123456?thread_ts=1695999999.000100
export function parsePermalink(value) {
    const groups = PERMALINK.exec(value)?.groups;
    if (!groups?.channel || !groups.seconds || !groups.micros)
        return undefined;
    const threadTs = /[?&]thread_ts=(\d+\.\d+)/.exec(value)?.[1];
    return { channel: groups.channel, ts: `${groups.seconds}.${groups.micros}`, threadTs };
}
// The thread a message link belongs to: the link's thread_ts for a reply, or the message itself.
export function parseThreadLink(value) {
    const link = parsePermalink(value);
    return link && { channel: link.channel, ts: link.threadTs ?? link.ts };
}
// A thread in `channel`, given as its parent ts or as a link to any message in it.
export function threadTsIn(channel, value) {
    const link = parseThreadLink(value);
    if (link) {
        if (link.channel !== channel) {
            throw new UsageError(`The thread link is in conversation ${link.channel}, not ${channel}.`);
        }
        return link.ts;
    }
    if (SLACK_TS.test(value))
        return value;
    throw new UsageError(`"${value}" is not a thread ts (like 1696000000.123456) or a message link.`);
}
// Accepts a Slack ts ("1696000000.123456"), unix seconds, or a date Date.parse understands.
export function toSlackTs(value) {
    if (/^\d{9,}(\.\d+)?$/.test(value))
        return value;
    const millis = Date.parse(value);
    if (Number.isNaN(millis)) {
        throw new UsageError(`Cannot read "${value}" as a time. Use a date like 2026-10-01 or a Slack ts.`);
    }
    return (millis / 1000).toFixed(6);
}
function userMatches(user, query) {
    const needle = query.toLowerCase().replace(/^@/, '');
    return [user.name, user.real_name, user.profile?.display_name, user.profile?.real_name, user.profile?.email]
        .some((field) => field?.toLowerCase().includes(needle));
}
export async function findUsers(client, query) {
    const matches = [];
    for await (const user of client.iterate('users.list', 'members')) {
        if (!user.deleted && userMatches(user, query))
            matches.push(user);
    }
    return matches;
}
// Usernames are unique, so they win. Display names are not, so one only counts when exactly one person has it.
async function resolveUserId(client, target) {
    const withoutAt = target.replace(/^@/, '');
    if (USER_ID.test(withoutAt))
        return withoutAt;
    const handle = withoutAt.toLowerCase();
    const byDisplayName = [];
    for await (const user of client.iterate('users.list', 'members')) {
        if (user.deleted)
            continue;
        if (user.name.toLowerCase() === handle)
            return user.id;
        if (user.profile?.display_name?.toLowerCase() === handle)
            byDisplayName.push(user);
    }
    const [only, ...others] = byDisplayName;
    if (only && others.length === 0)
        return only.id;
    if (only) {
        const candidates = byDisplayName.map((user) => `${user.id} (@${user.name}, ${user.real_name ?? 'no name'})`);
        throw new UsageError(`"@${handle}" matches several people: ${candidates.join('; ')}. Use their user ID instead.`);
    }
    throw new UsageError(`No user with handle "@${handle}". Try: slack-hop find-user ${handle}`);
}
// Turns "#general", "general", a channel ID, a message link, "@handle" or a user ID into a conversation ID.
// Users resolve to the DM conversation with them.
export async function resolveConversation(client, target) {
    const permalink = parsePermalink(target);
    if (permalink)
        return permalink.channel;
    if (CONVERSATION_ID.test(target))
        return target;
    if (target.startsWith('@') || USER_ID.test(target)) {
        const userId = await resolveUserId(client, target);
        const data = await client.call('conversations.open', { users: userId });
        return data.channel.id;
    }
    const name = target.replace(/^#/, '').toLowerCase();
    const channels = client.iterate('conversations.list', 'channels', {
        types: 'public_channel,private_channel',
        exclude_archived: true,
    }, 1000);
    for await (const channel of channels) {
        if (channel.name === name)
            return channel.id;
    }
    throw new UsageError(`No channel named "#${name}" that you can see. Try: slack-hop list-channels`);
}
