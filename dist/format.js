import { personLabel } from './person.js';
import { PREVIEW } from './constants.js';
import { SPECIAL, USER_MENTION } from './slack/slack-constants.js';
export function formatTs(ts) {
    const date = new Date(Number(ts) * 1000);
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
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
// Keeps the first `maxLines` lines and `maxChars` characters, counting whole characters so emoji are never
// split. Trailing whitespace is ignored, and the hidden count is taken before trimming the cut point.
export function truncate(text, { maxLines, maxChars, minHidden }) {
    const trimmed = text.trimEnd();
    const cut = Array.from(trimmed.split('\n').slice(0, maxLines).join('\n')).slice(0, maxChars);
    const hidden = Array.from(trimmed).length - cut.length;
    return hidden > minHidden ? { shown: cut.join('').trimEnd(), hidden } : { shown: trimmed, hidden: 0 };
}
// Rich-text elements hold raw characters, but renderText expects Slack's escaped text.
const escapeText = (raw) => raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Fields are guarded because Slack's data is not validated: one odd element must not fail the command.
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
            // Unhandled element types (images, buttons, ...) still arrive at runtime.
            return '';
    }
}
// mrkdwn arrives Slack-escaped; plain_text arrives raw and must be escaped for renderText.
function blockTextObject(object) {
    if (!object?.text)
        return undefined;
    return object.type === 'plain_text' ? escapeText(object.text) : object.text;
}
// Text from Block Kit blocks, one line per block and per paragraph in a rich-text block.
export function blockText(blocks = []) {
    return blocks
        .flatMap((block) => [
        blockTextObject(block.text),
        ...(block.fields ?? []).map(blockTextObject),
        ...(block.elements ?? []).map(elementText),
        ...(block.rows ?? []).map(rowText),
    ])
        .filter(Boolean)
        .join('\n');
}
const isRawTextCell = (cell) => cell.type === 'raw_text' && 'text' in cell && typeof cell.text === 'string';
// A table cell's paragraphs share its line. A missing cell reads as empty rather than failing the command.
function cellText(cell) {
    if (!cell)
        return '';
    return isRawTextCell(cell) ? escapeText(cell.text) : blockText([cell]).replace(/\n/g, ' ');
}
// A row of empty cells is skipped.
function rowText(row) {
    const cells = (Array.isArray(row) ? row : []).map(cellText);
    return cells.some(Boolean) ? cells.join(' | ') : undefined;
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
// Slack shows blocks instead of `text` when there are any, leaving `text` as a notification summary.
// Rich-text blocks only copy what a person typed, so only other block types hold more than the text.
function hasLayoutBlocks(message) {
    return (message.blocks ?? []).some((block) => block.type !== 'rich_text');
}
// Bots often write `text` in Markdown (**bold**, [label](url), - lists) while their rich-text blocks hold the
// same words styled, so the two are compared by their words alone, with links reduced to their labels.
function wordsOf(text) {
    return text
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>|]+\|([^>]*)>/g, '$1')
        .replace(/&(amp|lt|gt);/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}
// A bot's `text` may carry its tables as Markdown or leave them out, so both readings of the blocks are tried.
function repeatsText(blocks, text) {
    const words = wordsOf(text);
    if (words === '')
        return false;
    const withoutTables = blocks.filter((block) => !block.rows);
    return [blocks, withoutTables].some((candidate) => wordsOf(blockText(candidate)).includes(words));
}
// The text, unless the message has layout blocks: then the blocks, with the text above them only when the
// blocks don't repeat it.
function messageText(message) {
    const text = message.text?.trim() ? message.text : '';
    const fromBlocks = blockText(message.blocks);
    if (!hasLayoutBlocks(message))
        return text || fromBlocks;
    if (!fromBlocks)
        return text;
    if (!text || repeatsText(message.blocks ?? [], text))
        return fromBlocks;
    return `${text}\n${fromBlocks}`;
}
// Text, integration cards, shared messages, then files. Link previews are skipped when the message has text of
// its own. Unless `full` is set, long text is shortened; file markers are always shown.
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
