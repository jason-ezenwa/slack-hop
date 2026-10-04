const API_BASE = 'https://slack.com/api';
const TOKEN_PREFIX = 'SLACK_TOKEN_';
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const MAX_PAGE_SIZE = 200;

export type Env = Record<string, string | undefined>;
type Params = Record<string, string | number | boolean | undefined>;

export type SlackResponse = {
  ok: boolean;
  error?: string;
  needed?: string;
  response_metadata?: { next_cursor?: string };
};

export class UsageError extends Error {}

type SlackApiErrorDetails = {
  neededScope?: string;
  // True when Slack may or may not have carried out the request, e.g. after a network failure or a 5xx.
  outcomeUnknown?: boolean;
};

export class SlackApiError extends Error {
  readonly outcomeUnknown: boolean;

  constructor(
    readonly method: string,
    readonly code: string,
    { neededScope, outcomeUnknown = false }: SlackApiErrorDetails = {},
  ) {
    const scopeHint = neededScope ? ` (the Slack app needs the "${neededScope}" user scope)` : '';
    super(`Slack API ${method} failed: ${code}${scopeHint}`);
    this.outcomeUnknown = outcomeUnknown;
  }
}

function isValidWorkspaceName(workspace: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/i.test(workspace);
}

export function tokenEnvVar(workspace: string): string {
  if (!isValidWorkspaceName(workspace)) {
    throw new UsageError(
      `Invalid workspace name "${workspace}". Use letters, numbers and dashes, e.g. "client-b".`,
    );
  }
  return TOKEN_PREFIX + workspace.toUpperCase().replace(/-/g, '_');
}

// Workspaces with a token set, limited to variables that `--workspace <name>` can reach.
export function configuredWorkspaces(env: Env): string[] {
  const workspaces = Object.keys(env)
    .filter((key) => key.startsWith(TOKEN_PREFIX))
    .map((key) => key.slice(TOKEN_PREFIX.length).toLowerCase().replace(/_/g, '-'))
    .filter((workspace) => isValidWorkspaceName(workspace) && env[tokenEnvVar(workspace)]);
  return [...new Set(workspaces)].sort();
}

export function resolveToken(workspace: string, env: Env): string {
  const envVar = tokenEnvVar(workspace);
  const token = env[envVar];
  if (!token) {
    const known = configuredWorkspaces(env);
    const knownHint = known.length ? `Configured workspaces: ${known.join(', ')}.` : 'No workspaces are configured.';
    throw new UsageError(`No token for workspace "${workspace}": set ${envVar}. ${knownHint}`);
  }
  return token;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SlackClient {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  // `T` describes the fields the caller reads. Slack's JSON is trusted to match it; it is not validated.
  async call<T extends object = object>(method: string, params: Params = {}): Promise<T & SlackResponse> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) body.set(key, String(value));
    }

    for (let attempt = 0; ; attempt++) {
      const response = await this.post(method, body);

      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfterSeconds = Number(response.headers.get('retry-after')) || DEFAULT_RETRY_AFTER_SECONDS;
        await this.wait(retryAfterSeconds * 1000);
        continue;
      }
      if (!response.ok) {
        throw new SlackApiError(method, `http_${response.status}`, { outcomeUnknown: response.status >= 500 });
      }

      const data = (await response.json()) as T & SlackResponse;
      if (!data.ok) {
        throw new SlackApiError(method, data.error ?? 'unknown_error', { neededScope: data.needed });
      }
      return data;
    }
  }

  // Yields items across cursor-paginated pages, fetching the next page only when needed.
  async *iterate<T>(method: string, itemsKey: string, params: Params = {}, pageSize = MAX_PAGE_SIZE): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const data = await this.call<Record<string, unknown>>(method, { ...params, limit: pageSize, cursor });
      yield* (data[itemsKey] as T[] | undefined) ?? [];
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }

  async paginate<T>(method: string, itemsKey: string, params: Params, limit: number): Promise<T[]> {
    const items: T[] = [];
    for await (const item of this.iterate<T>(method, itemsKey, params, Math.min(MAX_PAGE_SIZE, limit))) {
      items.push(item);
      if (items.length >= limit) break;
    }
    return items;
  }

  private async post(method: string, body: URLSearchParams): Promise<Response> {
    try {
      return await this.fetchFn(`${API_BASE}/${method}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
    } catch (error) {
      const cause = error instanceof Error ? (error.cause ?? error).toString() : String(error);
      throw new SlackApiError(method, `network error talking to slack.com (${cause})`, { outcomeUnknown: true });
    }
  }
}
