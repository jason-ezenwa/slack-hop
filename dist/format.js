import { personLabel } from './person.js';
export function formatTs(ts) {
    const date = new Date(Number(ts) * 1000);
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
// Slack wraps mentions and links in <...>: <@U123>, <#C123|name>, <!here>, <https://url|label>.
const SPECIAL = /<([^>]+)>/g;
const USER_MENTION = /<@([UW][A-Z0-9]+)/g;
function renderSpecial(inner, userNames) {
    const separator = inner.indexOf('|');
    const target = separator === -1 ? inner : inner.slice(0, separator);
    const label = separator === -1 ? '' : inner.slice(separator + 1);
    if (target.startsWith('@'))
        return `@${userNames.get(target.slice(1)) ?? (label || target.slice(1))}`;
    if (target.startsWith('#'))
        return `#${label || target.slice(1)}`;
    if (target.startsWith('!'))
        return label || `@${target.slice(1).split('^')[0]}`;
    return label && label !== target ? `${label} (${target})` : target;
}
// Turns Slack's markup into plain text: names for user mentions, labels for channels and links, unescaped &, <, >.
export async function renderText(text, names) {
    const ids = new Set([...text.matchAll(USER_MENTION)].map(([, id]) => id).filter((id) => id !== undefined));
    const userNames = new Map(await Promise.all([...ids].map(async (id) => [id, (await names.get(id)).display])));
    return text
        .replace(SPECIAL, (_, inner) => renderSpecial(inner, userNames))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
// Cutting is only worth it when it hides more than `minHidden` characters; a smaller leftover is shown in full.
const PREVIEW = { maxLines: 6, maxChars: 400, minHidden: 100 };
// Keeps the first `maxLines` lines and `maxChars` characters (whole characters, so emoji are never split).
// Whitespace never decides whether a message is cut: trailing whitespace is ignored, and the hidden count is
// taken before trimming the cut point.
export function truncate(text, { maxLines, maxChars, minHidden }) {
    const trimmed = text.trimEnd();
    const cut = Array.from(trimmed.split('\n').slice(0, maxLines).join('\n')).slice(0, maxChars);
    const hidden = Array.from(trimmed).length - cut.length;
    return hidden > minHidden ? { shown: cut.join('').trimEnd(), hidden } : { shown: trimmed, hidden: 0 };
}
// Rich-text elements hold raw characters, but renderText expects Slack's escaped text.
const escapeText = (raw) => raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Converts a block element to Slack's escaped markup, which renderText then makes readable.
// Slack's data is not validated, so fields are guarded: one odd element must not fail the whole command.
function elementText(element) {
    switch (element.type) {
        case 'text':
        case 'plain_text':
            return escapeText(element.text ?? '');
        case 'mrkdwn':
            return element.text ?? '';
        case 'link':
            return element.text ? `<${element.url}|${escapeText(element.text)}>` : `<${element.url}>`;
        case 'user':
            return `<@${element.user_id}>`;
        case 'channel':
            return `<#${element.channel_id}>`;
        case 'usergroup':
            return `<!subteam^${element.usergroup_id}>`;
        case 'broadcast':
            return `<!${element.range}>`;
        case 'emoji':
            return `:${element.name}:`;
        case 'date':
            return escapeText(element.fallback ?? '');
        case 'rich_text_list':
            return (element.elements ?? []).map((item) => `• ${elementText(item)}`).join('\n');
        case 'rich_text_section':
        case 'rich_text_quote':
        case 'rich_text_preformatted':
            // The pieces of one paragraph sit side by side.
            return (element.elements ?? []).map(elementText).join('');
        default:
            // Element types slack-hop doesn't handle (images, buttons, ...) still arrive at runtime; skip them.
            return '';
    }
}
// Text from Block Kit blocks, for messages that carry their content there instead of in `text`.
// Each block, and each paragraph in a rich-text block, goes on its own line.
// Block text objects are either Slack-escaped mrkdwn or raw plain_text, which renderText needs escaped.
function blockTextObject(object) {
    if (!object?.text)
        return undefined;
    return object.type === 'plain_text' ? escapeText(object.text) : object.text;
}
export function blockText(blocks = []) {
    return blocks
        .flatMap((block) => [
        blockTextObject(block.text),
        ...(block.fields ?? []).map(blockTextObject),
        ...(block.elements ?? []).map(elementText),
    ])
        .filter(Boolean)
        .join('\n');
}
const isShare = (attachment) => Boolean(attachment.is_share || attachment.is_msg_unfurl);
const isLinkPreview = (attachment) => Boolean(attachment.from_url) && !isShare(attachment);
export function attachmentText(attachment) {
    const fields = (attachment.fields ?? []).map((field) => [field.title, field.value].filter(Boolean).join(': '));
    const author = attachment.author_name ? ` from ${attachment.author_name}` : '';
    const sharedFrom = isShare(attachment) ? `[shared message${author}]` : undefined;
    const parts = [attachment.pretext, attachment.title, attachment.text, ...fields].filter(Boolean);
    // The fallback is a plain summary Slack provides; it is only needed when nothing else is there.
    const content = parts.length ? parts.join('\n') : (attachment.fallback ?? '');
    return [sharedFrom, content].filter(Boolean).join('\n');
}
export async function messageAuthor(message, names) {
    if (message.user)
        return personLabel(await names.get(message.user));
    const named = message.username ?? message.bot_profile?.name;
    if (named)
        return named;
    if (message.bot_id) {
        const botName = await names.bot(message.bot_id);
        if (botName)
            return botName;
    }
    return 'unknown';
}
// Slack shows a message's blocks rather than its text when it has them; `text` is then only the notification
// summary (e.g. a bot's "New feedback submitted"). Rich-text blocks are just a copy of what a person typed,
// so only other block types (sections, headers, context, ...) mean the blocks hold more than the text.
function hasLayoutBlocks(message) {
    return (message.blocks ?? []).some((block) => block.type !== 'rich_text');
}
// The main text of a message: its blocks when they hold more than a copy of the text, else the text itself.
// A summary the blocks don't repeat (e.g. a bot that adds only a footer block) is kept above them.
function messageText(message) {
    const text = message.text?.trim() ? message.text : '';
    const fromBlocks = blockText(message.blocks);
    if (!hasLayoutBlocks(message))
        return text || fromBlocks;
    if (!fromBlocks)
        return text;
    if (!text || fromBlocks.includes(text))
        return fromBlocks;
    return `${text}\n${fromBlocks}`;
}
// The readable content of a message: its text (or its blocks when the text is empty), integration cards and
// shared messages, then its files. Link previews are skipped when the message has text of its own.
// Unless `full` is set, long text is shortened; file markers are always shown.
export async function messageBody(message, names, full) {
    const text = messageText(message);
    const attachments = (message.attachments ?? []).filter((attachment) => !text || !isLinkPreview(attachment));
    const rendered = await renderText([text, ...attachments.map(attachmentText)].filter(Boolean).join('\n'), names);
    const { shown, hidden } = full ? { shown: rendered, hidden: 0 } : truncate(rendered, PREVIEW);
    const body = hidden ? `${shown}… [${hidden} more characters, --full shows all]` : shown;
    const files = (message.files ?? []).map((file) => `[file: ${file.title ?? file.name ?? 'untitled'}]`).join(' ');
    return [body, files].filter(Boolean).join('\n');
}
export async function formatMessage(message, names, full) {
    const details = [`ts ${message.ts}`];
    if (message.reply_count)
        details.push(`${message.reply_count} replies`);
    const header = `[${formatTs(message.ts)}] ${await messageAuthor(message, names)}`;
    return `${header}: ${await messageBody(message, names, full)}\n    (${details.join(', ')})`;
}
export function printJson(data) {
    console.log(JSON.stringify(data, null, 2));
}
// Prints items as JSON, as one formatted entry each, or as `emptyText` when there are none.
export async function printList(items, json, emptyText, formatItem) {
    if (json) {
        printJson(items);
        return;
    }
    if (items.length === 0) {
        console.log(emptyText);
        return;
    }
    for (const item of items)
        console.log(await formatItem(item));
}
