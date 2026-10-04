import { describe, expect, it, vi } from 'vitest';
import { configuredWorkspaces, resolveToken, SlackApiError, SlackClient, tokenEnvVar, UsageError } from '../src/slack-client.js';
import { fakeFetch, fakeSlack } from './fake-slack.js';

describe('tokenEnvVar', () => {
  it('maps a workspace name to its environment variable', () => {
    expect(tokenEnvVar('client-b')).toBe('SLACK_TOKEN_CLIENT_B');
    expect(tokenEnvVar('Acme')).toBe('SLACK_TOKEN_ACME');
  });

  it('rejects names that cannot round-trip through an environment variable', () => {
    expect(() => tokenEnvVar('client_b')).toThrow(UsageError);
    expect(() => tokenEnvVar('-b')).toThrow(UsageError);
    expect(() => tokenEnvVar('')).toThrow(UsageError);
  });
});

describe('configuredWorkspaces', () => {
  it('lists workspaces that have a non-empty token, sorted', () => {
    const env = { SLACK_TOKEN_CLIENT_B: 'x', SLACK_TOKEN_ACME: 'y', SLACK_TOKEN_EMPTY: '', SLACK_TOKEN_: 'z', PATH: '/bin' };
    expect(configuredWorkspaces(env)).toEqual(['acme', 'client-b']);
  });

  it('skips variables that --workspace cannot reach', () => {
    expect(configuredWorkspaces({ SLACK_TOKEN_client_b: 'x', SLACK_TOKEN_FOO_: 'y', SLACK_TOKEN_OK: 'z' })).toEqual(['ok']);
    expect(configuredWorkspaces({ SLACK_TOKEN_client_b: 'x', SLACK_TOKEN_CLIENT_B: '' })).toEqual([]);
  });

  it('lists a workspace once even when differently cased variables exist', () => {
    expect(configuredWorkspaces({ SLACK_TOKEN_CLIENT_B: 'x', SLACK_TOKEN_client_b: 'y' })).toEqual(['client-b']);
  });
});

describe('resolveToken', () => {
  it('returns the token for the workspace', () => {
    expect(resolveToken('client-b', { SLACK_TOKEN_CLIENT_B: 'xoxp-1' })).toBe('xoxp-1');
  });

  it('names the missing variable and the configured workspaces', () => {
    expect(() => resolveToken('client-c', { SLACK_TOKEN_CLIENT_B: 'xoxp-1' })).toThrow(
      'No token for workspace "client-c": set SLACK_TOKEN_CLIENT_C. Configured workspaces: client-b.',
    );
  });
});

describe('SlackClient.call', () => {
  it('sends the token and form-encoded params, skipping undefined ones', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const client = new SlackClient(
      'xoxp-1',
      fakeFetch((url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ ok: true, value: 1 }));
      }),
    );

    const data = await client.call<{ value: number }>('conversations.history', { channel: 'C1', oldest: undefined, limit: 5 });

    expect(data.value).toBe(1);
    expect(requests[0]?.url).toBe('https://slack.com/api/conversations.history');
    expect((requests[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer xoxp-1');
    expect(String(requests[0]?.init?.body)).toBe('channel=C1&limit=5');
  });

  it('raises Slack errors with the missing scope', async () => {
    const { fetchFn } = fakeSlack({ 'search.messages': () => ({ ok: false, error: 'missing_scope', needed: 'search:read' }) });

    const error = await new SlackClient('xoxp-1', fetchFn).call('search.messages').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SlackApiError);
    expect((error as SlackApiError).message).toBe(
      'Slack API search.messages failed: missing_scope (the Slack app needs the "search:read" user scope)',
    );
  });

  it('waits for Retry-After and retries when rate limited', async () => {
    const responses = [
      new Response('', { status: 429, headers: { 'retry-after': '2' } }),
      new Response(JSON.stringify({ ok: true })),
    ];
    const wait = vi.fn(async () => {});
    const client = new SlackClient('xoxp-1', fakeFetch(() => responses.shift() as Response), wait);

    await client.call('users.list');

    expect(wait).toHaveBeenCalledWith(2000);
    expect(responses).toHaveLength(0);
  });

  it('marks server errors as having an unknown outcome', async () => {
    const client = new SlackClient('xoxp-1', fakeFetch(() => new Response('', { status: 503 })));
    const error = await client.call('chat.postMessage').catch((caught: unknown) => caught);
    expect((error as SlackApiError).outcomeUnknown).toBe(true);
  });

  it('gives up after repeated rate limiting', async () => {
    const client = new SlackClient('xoxp-1', fakeFetch(() => new Response('', { status: 429 })), async () => {});
    await expect(client.call('users.list')).rejects.toThrow('Slack API users.list failed: http_429');
  });

  it('marks network failures, whose outcome is unknown', async () => {
    const client = new SlackClient(
      'xoxp-1',
      fakeFetch(() => {
        throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
      }),
    );

    const error = await client.call('auth.test').catch((caught: unknown) => caught);

    expect((error as SlackApiError).outcomeUnknown).toBe(true);
    expect((error as SlackApiError).message).toMatch(/network error talking to slack\.com.*ECONNREFUSED/);
  });
});

describe('SlackClient.paginate', () => {
  it('follows cursors and stops at the limit', async () => {
    const pages: Record<string, { items: number[]; next: string }> = {
      '': { items: [1, 2], next: 'p2' },
      p2: { items: [3, 4], next: 'p3' },
      p3: { items: [5], next: '' },
    };
    const { fetchFn, calls } = fakeSlack({
      'users.list': (params) => {
        const page = pages[params.get('cursor') ?? ''] as { items: number[]; next: string };
        return { members: page.items, response_metadata: { next_cursor: page.next } };
      },
    });
    const client = new SlackClient('xoxp-1', fetchFn);

    expect(await client.paginate('users.list', 'members', {}, 3)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(2);
    expect(await client.paginate('users.list', 'members', {}, 100)).toEqual([1, 2, 3, 4, 5]);
  });
});
