// Slack's API objects are typed only as far as slack-hop reads them.

export type SlackUser = {
  id: string;
  name: string;
  deleted?: boolean;
  is_bot?: boolean;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string; email?: string };
};

export type SlackChannel = {
  id: string;
  name?: string;
  user?: string;
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
};

// Legacy attachments: integration cards, link previews (`from_url`), and shared messages (`is_share`,
// `is_msg_unfurl`), which also carry `from_url`.
export type SlackAttachment = {
  fallback?: string;
  pretext?: string;
  author_name?: string;
  title?: string;
  text?: string;
  fields?: { title?: string; value?: string }[];
  from_url?: string;
  is_share?: boolean;
  is_msg_unfurl?: boolean;
};

// Block Kit text: `mrkdwn` arrives Slack-escaped, `plain_text` arrives raw.
export type SlackTextObject = { type?: string; text?: string };

// Block Kit blocks; only the text-bearing parts are typed.
export type SlackBlock = {
  type: string;
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  elements?: SlackBlockElement[];
  // Table blocks only.
  rows?: SlackTableCell[][];
};

export type SlackRawTextCell = { type: 'raw_text'; text: string };
export type SlackTableCell = SlackBlock | SlackRawTextCell;

// The rich-text and context elements slack-hop reads. Others (images, buttons, ...) are ignored.
export type SlackBlockElement =
  | { type: 'text' | 'plain_text'; text: string }
  | { type: 'mrkdwn'; text: string }
  | { type: 'link'; url: string; text?: string }
  | { type: 'user'; user_id: string }
  | { type: 'channel'; channel_id: string }
  | { type: 'usergroup'; usergroup_id: string }
  | { type: 'broadcast'; range: string }
  | { type: 'emoji'; name: string }
  | { type: 'date'; fallback?: string }
  | { type: 'rich_text_section' | 'rich_text_quote' | 'rich_text_preformatted' | 'rich_text_list'; elements: SlackBlockElement[] };

export type SlackMessage = {
  ts: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  bot_profile?: { name?: string };
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  files?: { name?: string; title?: string }[];
};

export type SlackResponse = {
  ok: boolean;
  error?: string;
  needed?: string;
  response_metadata?: { next_cursor?: string };
};

export type SlackApiErrorDetails = {
  neededScope?: string;
  // True when Slack may or may not have carried out the request, e.g. after a network failure or a 5xx.
  outcomeUnknown?: boolean;
};

export type Params = Record<string, string | number | boolean | undefined>;

export type SearchMatch = SlackMessage & {
  permalink: string;
  channel?: { id: string; name?: string; is_im?: boolean };
};

export type AuthTest = { team: string; user: string; url: string };
export type Posted = { channel: string; ts: string };

export type Permalink = { channel: string; ts: string; threadTs?: string };
export type ThreadRef = { channel: string; ts: string };
