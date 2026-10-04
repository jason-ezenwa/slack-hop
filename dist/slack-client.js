const API_BASE = 'https://slack.com/api';
const TOKEN_PREFIX = 'SLACK_TOKEN_';
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const MAX_PAGE_SIZE = 200;
export class UsageError extends Error {
}
export class SlackApiError extends Error {
    method;
    code;
    outcomeUnknown;
    constructor(method, code, { neededScope, outcomeUnknown = false } = {}) {
        const scopeHint = neededScope ? ` (the Slack app needs the "${neededScope}" user scope)` : '';
        super(`Slack API ${method} failed: ${code}${scopeHint}`);
        this.method = method;
        this.code = code;
        this.outcomeUnknown = outcomeUnknown;
    }
}
function isValidWorkspaceName(workspace) {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/i.test(workspace);
}
export function tokenEnvVar(workspace) {
    if (!isValidWorkspaceName(workspace)) {
        throw new UsageError(`Invalid workspace name "${workspace}". Use letters, numbers and dashes, e.g. "client-b".`);
    }
    return TOKEN_PREFIX + workspace.toUpperCase().replace(/-/g, '_');
}
// Workspaces with a token set, limited to variables that `--workspace <name>` can reach.
export function configuredWorkspaces(env) {
    const workspaces = Object.keys(env)
        .filter((key) => key.startsWith(TOKEN_PREFIX))
        .map((key) => key.slice(TOKEN_PREFIX.length).toLowerCase().replace(/_/g, '-'))
        .filter((workspace) => isValidWorkspaceName(workspace) && env[tokenEnvVar(workspace)]);
    return [...new Set(workspaces)].sort();
}
export function resolveToken(workspace, env) {
    const envVar = tokenEnvVar(workspace);
    const token = env[envVar];
    if (!token) {
        const known = configuredWorkspaces(env);
        const knownHint = known.length ? `Configured workspaces: ${known.join(', ')}.` : 'No workspaces are configured.';
        throw new UsageError(`No token for workspace "${workspace}": set ${envVar}. ${knownHint}`);
    }
    return token;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class SlackClient {
    token;
    fetchFn;
    wait;
    constructor(token, fetchFn = fetch, wait = sleep) {
        this.token = token;
        this.fetchFn = fetchFn;
        this.wait = wait;
    }
    // `T` describes the fields the caller reads. Slack's JSON is trusted to match it; it is not validated.
    async call(method, params = {}) {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined)
                body.set(key, String(value));
        }
        for (let attempt = 0;; attempt++) {
            const response = await this.post(method, body);
            if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
                const retryAfterSeconds = Number(response.headers.get('retry-after')) || DEFAULT_RETRY_AFTER_SECONDS;
                await this.wait(retryAfterSeconds * 1000);
                continue;
            }
            if (!response.ok) {
                throw new SlackApiError(method, `http_${response.status}`, { outcomeUnknown: response.status >= 500 });
            }
            const data = (await response.json());
            if (!data.ok) {
                throw new SlackApiError(method, data.error ?? 'unknown_error', { neededScope: data.needed });
            }
            return data;
        }
    }
    // Yields items across cursor-paginated pages, fetching the next page only when needed.
    async *iterate(method, itemsKey, params = {}, pageSize = MAX_PAGE_SIZE) {
        let cursor;
        do {
            const data = await this.call(method, { ...params, limit: pageSize, cursor });
            yield* data[itemsKey] ?? [];
            cursor = data.response_metadata?.next_cursor || undefined;
        } while (cursor);
    }
    async paginate(method, itemsKey, params, limit) {
        const items = [];
        for await (const item of this.iterate(method, itemsKey, params, Math.min(MAX_PAGE_SIZE, limit))) {
            items.push(item);
            if (items.length >= limit)
                break;
        }
        return items;
    }
    async post(method, body) {
        try {
            return await this.fetchFn(`${API_BASE}/${method}`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body,
            });
        }
        catch (error) {
            const cause = error instanceof Error ? (error.cause ?? error).toString() : String(error);
            throw new SlackApiError(method, `network error talking to slack.com (${cause})`, { outcomeUnknown: true });
        }
    }
}
