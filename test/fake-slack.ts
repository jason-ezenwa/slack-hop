// Stand-ins for Slack's Web API, passed to SlackClient in place of the real fetch.

export function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => respond(String(url), init)) as typeof fetch;
}

// Maps each API method to a handler returning the JSON body; `ok: true` is added unless the handler sets it.
export type Handler = (params: URLSearchParams) => Record<string, unknown>;

export function fakeSlack(handlers: Record<string, Handler>) {
  const calls: { method: string; params: URLSearchParams }[] = [];
  const fetchFn = fakeFetch((url, init) => {
    const method = url.slice(url.indexOf('/api/') + '/api/'.length);
    const params = new URLSearchParams(init?.body as URLSearchParams);
    calls.push({ method, params });
    const handler = handlers[method];
    const body = handler ? { ok: true, ...handler(params) } : { ok: false, error: 'unknown_method' };
    return new Response(JSON.stringify(body));
  });
  return { fetchFn, calls };
}
