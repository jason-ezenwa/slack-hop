import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { fakeSlack, type Handler } from './fake-slack.js';

const ENV = { SLACK_TOKEN_CLIENT_B: 'xoxp-1' };
const LINK = 'https://acme.slack.com/archives/C0000GENERAL/p1790812900000300?thread_ts=1790812800.000100';

let output: string[];
let errors: string[];

beforeEach(() => {
  output = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => output.push(line));
  vi.spyOn(console, 'error').mockImplementation((line: string) => errors.push(line));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubSlack(handlers: Record<string, Handler>) {
  const slack = fakeSlack({
    'conversations.list': () => ({ channels: [{ id: 'C0000GENERAL', name: 'general' }] }),
    'users.info': () => ({ user: { id: 'U0000JANE', name: 'jane.doe', profile: { display_name: 'Jane' } } }),
    ...handlers,
  });
  vi.stubGlobal('fetch', slack.fetchFn);
  return slack.calls;
}

describe('help', () => {
  it('lists every command', async () => {
    expect(await main(['--help'], {})).toBe(0);
    const help = output.join('\n');
    for (const name of ['workspaces', 'list-channels', 'read-channel', 'read-thread', 'search', 'send-message', 'find-user']) {
      expect(help).toContain(name);
    }
  });

  it('shows a command\'s usage', async () => {
    expect(await main(['read-thread', '--help'], {})).toBe(0);
    expect(output.join('\n')).toContain('Usage: slack-hop read-thread <message-link>');
  });
});

describe('usage errors exit 2', () => {
  it('rejects an unknown command', async () => {
    expect(await main(['nope'], {})).toBe(2);
  });

  it('rejects an unknown flag', async () => {
    expect(await main(['read-channel', 'general', '--bogus', '-w', 'client-b'], ENV)).toBe(2);
  });

  it('requires --workspace', async () => {
    expect(await main(['read-channel', 'general'], ENV)).toBe(2);
    expect(errors.join('\n')).toContain('Missing --workspace <name>');
  });

  it('does not take --workspace on commands that span all workspaces', async () => {
    expect(await main(['workspaces', '--workspace', 'client-b'], ENV)).toBe(2);
  });

  it('names the missing token variable', async () => {
    expect(await main(['read-channel', 'general', '--workspace', 'client-c'], ENV)).toBe(2);
    expect(errors.join('\n')).toContain('set SLACK_TOKEN_CLIENT_C');
  });
});

describe('read-channel', () => {
  it('prints messages oldest first with names in place of user IDs', async () => {
    const calls = stubSlack({
      'conversations.history': () => ({
        messages: [
          { ts: '1790812860.000200', user: 'U0000JANE', text: 'second, cc <@U0000JANE>' },
          { ts: '1790812800.000100', user: 'U0000JANE', text: 'first', reply_count: 2 },
        ],
      }),
    });

    expect(await main(['read-channel', '#general', '-w', 'client-b'], ENV)).toBe(0);

    expect(output).toEqual([
      '[2026-10-01 00:00 UTC] Jane (@jane.doe): first\n    (ts 1790812800.000100, 2 replies)',
      '[2026-10-01 00:01 UTC] Jane (@jane.doe): second, cc @Jane\n    (ts 1790812860.000200)',
    ]);
    expect(calls.filter((call) => call.method === 'users.info')).toHaveLength(1);
  });

  it('shortens long messages unless --full is given', async () => {
    const long = 'word '.repeat(200).trim();
    stubSlack({ 'conversations.history': () => ({ messages: [{ ts: '1790812800.000100', user: 'U0000JANE', text: long }] }) });

    expect(await main(['read-channel', 'C0123ABCD', '-w', 'client-b'], ENV)).toBe(0);
    expect(output[0]).toContain('more characters, --full shows all]');

    output.length = 0;
    expect(await main(['read-channel', 'C0123ABCD', '-w', 'client-b', '--full'], ENV)).toBe(0);
    expect(output[0]).toContain(long);
  });

  it('exits 1 with the Slack error when the API call fails', async () => {
    stubSlack({ 'conversations.history': () => ({ ok: false, error: 'not_in_channel' }) });
    expect(await main(['read-channel', 'C0123ABCD', '-w', 'client-b'], ENV)).toBe(1);
    expect(errors).toEqual(['Slack API conversations.history failed: not_in_channel']);
  });
});

describe('read-thread', () => {
  it('reads the whole thread from a link to a reply, showing the repeated parent once', async () => {
    const parent = { ts: '1790812800.000100', user: 'U0000JANE', text: 'parent' };
    const calls = stubSlack({
      'conversations.replies': (params) =>
        params.get('cursor')
          ? { messages: [parent, { ts: '1790812960.000400', user: 'U0000JANE', text: 'reply 2' }] }
          : {
              messages: [parent, { ts: '1790812900.000300', user: 'U0000JANE', text: 'reply 1' }],
              response_metadata: { next_cursor: 'p2' },
            },
    });

    expect(await main(['read-thread', LINK, '-w', 'client-b'], ENV)).toBe(0);

    expect(output.map((line) => line.split('\n')[0])).toEqual([
      '[2026-10-01 00:00 UTC] Jane (@jane.doe): parent',
      '[2026-10-01 00:01 UTC] Jane (@jane.doe): reply 1',
      '[2026-10-01 00:02 UTC] Jane (@jane.doe): reply 2',
    ]);
    expect(calls[0]?.params.get('channel')).toBe('C0000GENERAL');
    expect(calls[0]?.params.get('ts')).toBe('1790812800.000100');
  });

  it('refuses a link from another conversation in the two-argument form', async () => {
    const calls = stubSlack({ 'conversations.replies': () => ({ messages: [] }) });
    expect(await main(['read-thread', 'C0000OTHER1', LINK, '-w', 'client-b'], ENV)).toBe(2);
    expect(calls.some((call) => call.method === 'conversations.replies')).toBe(false);
  });

  it('takes a channel and a ts', async () => {
    const calls = stubSlack({ 'conversations.replies': () => ({ messages: [] }) });
    expect(await main(['read-thread', 'general', '1790812800.000100', '-w', 'client-b'], ENV)).toBe(0);
    const replies = calls.find((call) => call.method === 'conversations.replies');
    expect(replies?.params.get('channel')).toBe('C0000GENERAL');
    expect(replies?.params.get('ts')).toBe('1790812800.000100');
  });
});

describe('send-message', () => {
  const posted = () => ({ channel: 'C0000GENERAL', ts: '1790813000.000500' });

  it('posts all the words after the channel and prints the link', async () => {
    const calls = stubSlack({
      'chat.postMessage': posted,
      'chat.getPermalink': () => ({ permalink: 'https://acme.slack.com/archives/C0000GENERAL/p1790813000000500' }),
    });

    expect(await main(['send-message', 'general', 'hello', 'world', '-w', 'client-b'], ENV)).toBe(0);

    const post = calls.find((call) => call.method === 'chat.postMessage');
    expect(post?.params.get('channel')).toBe('C0000GENERAL');
    expect(post?.params.get('text')).toBe('hello world');
    expect(post?.params.has('thread_ts')).toBe(false);
    expect(output).toEqual([
      'Sent to C0000GENERAL (ts 1790813000.000500): https://acme.slack.com/archives/C0000GENERAL/p1790813000000500',
    ]);
  });

  it('replies in the thread when given a message link as the channel', async () => {
    const calls = stubSlack({ 'chat.postMessage': posted, 'chat.getPermalink': () => ({ permalink: 'x' }) });
    expect(await main(['send-message', LINK, 'on it', '-w', 'client-b'], ENV)).toBe(0);
    const post = calls.find((call) => call.method === 'chat.postMessage');
    expect(post?.params.get('channel')).toBe('C0000GENERAL');
    expect(post?.params.get('thread_ts')).toBe('1790812800.000100');
  });

  it('refuses a --thread link from another conversation', async () => {
    const calls = stubSlack({ 'chat.postMessage': posted });
    expect(await main(['send-message', 'C0000OTHER1', 'hi', '--thread', LINK, '-w', 'client-b'], ENV)).toBe(2);
    expect(calls.some((call) => call.method === 'chat.postMessage')).toBe(false);
  });

  it('checks for text before looking anything up', async () => {
    const calls = stubSlack({});
    expect(await main(['send-message', '@jane', '-w', 'client-b'], ENV)).toBe(2);
    expect(errors.join('\n')).toContain('Missing <text>.');
    expect(calls).toHaveLength(0);
  });

  it('still reports success when the permalink lookup fails', async () => {
    stubSlack({ 'chat.postMessage': posted, 'chat.getPermalink': () => ({ ok: false, error: 'ratelimited' }) });
    expect(await main(['send-message', 'general', 'hi', '-w', 'client-b'], ENV)).toBe(0);
    expect(output).toEqual(['Sent to C0000GENERAL (ts 1790813000.000500).']);
  });

  it('warns that the message may have been sent when the network fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    expect(await main(['send-message', 'C0000GENERAL', 'hi', '-w', 'client-b'], ENV)).toBe(1);
    expect(errors.join('\n')).toContain('The message may have been sent; check the conversation before retrying');
  });

  it('warns that the message may have been sent when Slack has a server error', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));
    expect(await main(['send-message', 'C0000GENERAL', 'hi', '-w', 'client-b'], ENV)).toBe(1);
    expect(errors).toEqual([
      'Slack API chat.postMessage failed: http_500. The message may have been sent; check the conversation before retrying',
    ]);
  });
});

describe('search', () => {
  it('labels where each match is from, shortens it, and links to it', async () => {
    stubSlack({
      'search.messages': () => ({
        messages: {
          matches: [
            {
              ts: '1790812800.000100',
              user: 'U0000JANE',
              text: 'deploy '.repeat(100).trim(),
              permalink: 'https://acme.slack.com/archives/C0000GENERAL/p1790812800000100',
              channel: { id: 'C0000GENERAL', name: 'general' },
            },
          ],
        },
      }),
    });

    expect(await main(['search', 'deploy', '-w', 'client-b'], ENV)).toBe(0);

    expect(output[0]).toMatch(/^\[2026-10-01 00:00 UTC\] #general · Jane \(@jane\.doe\): deploy deploy/);
    expect(output[0]).toContain('--full shows all]');
    expect(output[0]).toContain('(https://acme.slack.com/archives/C0000GENERAL/p1790812800000100)');
  });

  it('names the other person for matches in DMs', async () => {
    const dm = (channel: string, ts: string) => ({
      ts,
      user: 'U0000JANE',
      text: 'hello',
      permalink: `https://acme.slack.com/archives/${channel}/p1`,
      channel: { id: channel, is_im: true },
    });
    const calls = stubSlack({
      'search.messages': () => ({ messages: { matches: [dm('D0000SAM01', '1790812800.000100'), dm('D0000ALEX1', '1790812860.000200'), dm('D0000SAM01', '1790812920.000300')] } }),
      'conversations.info': (params) => ({ channel: { user: params.get('channel') === 'D0000SAM01' ? 'U0000SAM' : 'U0000ALEX' } }),
      'users.info': (params) =>
        ({
          U0000JANE: { user: { id: 'U0000JANE', name: 'jane.doe', profile: { display_name: 'Jane' } } },
          U0000SAM: { user: { id: 'U0000SAM', name: 'sam', profile: { display_name: 'Sam' } } },
          U0000ALEX: { user: { id: 'U0000ALEX', name: 'alex', profile: { display_name: 'Alex' } } },
        })[params.get('user') as string] ?? { ok: false, error: 'user_not_found' },
    });

    expect(await main(['search', 'hello', '-w', 'client-b'], ENV)).toBe(0);

    const locations = output.map((line) => line.slice('[2026-10-01 00:00 UTC] '.length, line.indexOf(' · ')));
    expect(locations).toEqual([
      'DM with Sam (@sam)',
      'DM with Alex (@alex)',
      'DM with Sam (@sam)',
    ]);
    expect(calls.filter((call) => call.method === 'conversations.info')).toHaveLength(2);
  });
});

describe('list-channels', () => {
  it('labels DMs with the person\'s name and handle', async () => {
    stubSlack({
      'users.conversations': () => ({
        channels: [
          { id: 'C0000GENERAL', name: 'general' },
          { id: 'G0000SECRET', name: 'secret', is_private: true },
          { id: 'D0000JANE', is_im: true, user: 'U0000JANE' },
        ],
      }),
      'users.list': () => ({ members: [{ id: 'U0000JANE', name: 'jane.doe', profile: { display_name: 'Jane' } }] }),
    });

    expect(await main(['list-channels', '--types', 'public,private,dm', '-w', 'client-b'], ENV)).toBe(0);

    expect(output).toEqual(['C0000GENERAL  #general', 'G0000SECRET  #secret (private)', 'D0000JANE  DM with Jane (@jane.doe)']);
  });
});

describe('find-user', () => {
  it('shows ID, name with handle, full name and email', async () => {
    stubSlack({
      'users.list': () => ({
        members: [
          { id: 'U0000JASON', name: 'chukwuemelie.ezenwa', real_name: 'Chukwuemelie Obumse', profile: { display_name: 'Jason', real_name: 'Chukwuemelie Obumse', email: 'me@example.com' } },
          { id: 'U0000OTHER', name: 'other', profile: { display_name: 'Someone' } },
        ],
      }),
    });

    expect(await main(['find-user', 'jason', '-w', 'client-b'], ENV)).toBe(0);

    expect(output).toEqual(['U0000JASON  Jason (@chukwuemelie.ezenwa)  Chukwuemelie Obumse  me@example.com']);
  });
});

describe('workspaces', () => {
  it('shows each workspace\'s team, or why its token was rejected', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const authorized = (init.headers as Record<string, string>).Authorization === 'Bearer xoxp-good';
      const body = authorized ? { ok: true, team: 'Acme', user: 'me', url: 'https://acme.slack.com/' } : { ok: false, error: 'invalid_auth' };
      return new Response(JSON.stringify(body));
    });

    expect(await main(['workspaces'], { SLACK_TOKEN_ACME: 'xoxp-good', SLACK_TOKEN_OLD: 'xoxp-revoked' })).toBe(0);

    expect(output).toEqual(['acme: Acme as @me (https://acme.slack.com/)', 'old: token rejected (invalid_auth)']);
  });
});
