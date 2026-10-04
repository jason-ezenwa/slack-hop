import { describe, expect, it } from 'vitest';
import { parsePermalink, parseThreadLink, resolveConversation, threadTsIn, toSlackTs } from '../src/resolve.js';
import { SlackClient, UsageError } from '../src/slack-client.js';
import { fakeSlack } from './fake-slack.js';

describe('parsePermalink', () => {
  it('reads the channel and message ts from a message link', () => {
    expect(parsePermalink('https://acme.slack.com/archives/C0123ABCD/p1696000000123456')).toEqual({
      channel: 'C0123ABCD',
      ts: '1696000000.123456',
      threadTs: undefined,
    });
  });

  it('reads the thread ts from a reply link', () => {
    const link = 'https://acme.slack.com/archives/C0123ABCD/p1696000500000200?thread_ts=1696000000.123456&cid=C0123ABCD';
    expect(parsePermalink(link)?.threadTs).toBe('1696000000.123456');
  });

  it('ignores anything that is not a message link', () => {
    expect(parsePermalink('general')).toBeUndefined();
  });
});

describe('threads', () => {
  const reply = 'https://acme.slack.com/archives/C0123ABCD/p1696000500000200?thread_ts=1696000000.123456';

  it('takes the thread from a link to a reply, or the message itself from a top-level link', () => {
    expect(parseThreadLink(reply)).toEqual({ channel: 'C0123ABCD', ts: '1696000000.123456' });
    expect(parseThreadLink('https://acme.slack.com/archives/C0123ABCD/p1696000000123456')?.ts).toBe('1696000000.123456');
    expect(parseThreadLink('1696000000.123456')).toBeUndefined();
  });

  it('accepts a bare ts or a link in the same channel', () => {
    expect(threadTsIn('C0123ABCD', '1696000000.123456')).toBe('1696000000.123456');
    expect(threadTsIn('C0123ABCD', reply)).toBe('1696000000.123456');
  });

  it('rejects links from other conversations and anything that is not a ts', () => {
    expect(() => threadTsIn('C0000OTHER1', reply)).toThrow('The thread link is in conversation C0123ABCD, not C0000OTHER1.');
    expect(() => threadTsIn('C0123ABCD', 'general')).toThrow(UsageError);
  });
});

describe('toSlackTs', () => {
  it('passes Slack timestamps through', () => {
    expect(toSlackTs('1696000000.123456')).toBe('1696000000.123456');
  });

  it('converts dates to Slack timestamps', () => {
    expect(toSlackTs('2026-10-01T00:00:00Z')).toBe('1790812800.000000');
  });

  it('reads a bare year as a date, not as seconds since 1970', () => {
    expect(toSlackTs('2026')).toBe('1767225600.000000');
  });

  it('rejects text that is not a time', () => {
    expect(() => toSlackTs('yesterday')).toThrow(UsageError);
  });
});

describe('resolveConversation', () => {
  const users = [
    { id: 'U0000IMPOSTER', name: 'imposter', profile: { display_name: 'jane' } },
    { id: 'U0000JANE', name: 'jane', profile: { display_name: 'Jane D' } },
    { id: 'U0000GONE', name: 'gone', deleted: true },
    { id: 'U0000SAM1', name: 'sam.one', real_name: 'Sam One', profile: { display_name: 'sam' } },
    { id: 'U0000SAM2', name: 'sam.two', real_name: 'Sam Two', profile: { display_name: 'sam' } },
  ];
  const slack = () =>
    fakeSlack({
      'conversations.list': (params) =>
        params.get('cursor')
          ? { channels: [{ id: 'C0000GENERAL', name: 'general' }, { id: 'C0000UPDATES', name: 'updates' }] }
          : { channels: [{ id: 'C0000RANDOM', name: 'random' }], response_metadata: { next_cursor: 'p2' } },
      'users.list': () => ({ members: users }),
      'conversations.open': (params) => ({ channel: { id: `D-${params.get('users')}` } }),
    });

  it('uses conversation IDs and message links as they are', async () => {
    const { fetchFn, calls } = slack();
    const client = new SlackClient('xoxp-1', fetchFn);
    expect(await resolveConversation(client, 'C0123ABCD')).toBe('C0123ABCD');
    expect(await resolveConversation(client, 'https://a.slack.com/archives/G0123ABCD/p1696000000123456')).toBe('G0123ABCD');
    expect(calls).toHaveLength(0);
  });

  it('finds channels by name across pages, with or without #', async () => {
    const client = new SlackClient('xoxp-1', slack().fetchFn);
    expect(await resolveConversation(client, '#general')).toBe('C0000GENERAL');
    expect(await resolveConversation(client, 'General')).toBe('C0000GENERAL');
  });

  it('treats all-caps names as names, not IDs', async () => {
    const client = new SlackClient('xoxp-1', slack().fetchFn);
    expect(await resolveConversation(client, 'GENERAL')).toBe('C0000GENERAL');
    expect(await resolveConversation(client, 'UPDATES')).toBe('C0000UPDATES');
  });

  it('opens a DM for a handle or user ID', async () => {
    const client = new SlackClient('xoxp-1', slack().fetchFn);
    expect(await resolveConversation(client, '@jane')).toBe('D-U0000JANE');
    expect(await resolveConversation(client, '@jane d')).toBe('D-U0000JANE');
    expect(await resolveConversation(client, 'U0000JANE')).toBe('D-U0000JANE');
    expect(await resolveConversation(client, '@U0000JANE')).toBe('D-U0000JANE');
  });

  it('prefers a username over someone else\'s matching display name', async () => {
    const client = new SlackClient('xoxp-1', slack().fetchFn);
    expect(await resolveConversation(client, '@jane')).toBe('D-U0000JANE');
  });

  it('refuses a display name shared by several people', async () => {
    const { fetchFn, calls } = slack();
    await expect(resolveConversation(new SlackClient('xoxp-1', fetchFn), '@sam')).rejects.toThrow(
      '"@sam" matches several people: U0000SAM1 (@sam.one, Sam One); U0000SAM2 (@sam.two, Sam Two)',
    );
    expect(calls.some((call) => call.method === 'conversations.open')).toBe(false);
  });

  it('explains when nothing matches', async () => {
    const client = new SlackClient('xoxp-1', slack().fetchFn);
    await expect(resolveConversation(client, '#nope')).rejects.toThrow('No channel named "#nope"');
    await expect(resolveConversation(client, '@gone')).rejects.toThrow('No user with handle "@gone"');
  });
});
