export const API_BASE = 'https://slack.com/api';
export const TOKEN_PREFIX = 'SLACK_TOKEN_';
export const MAX_RATE_LIMIT_RETRIES = 3;
export const DEFAULT_RETRY_AFTER_SECONDS = 1;
export const MAX_PAGE_SIZE = 200;
// Slack IDs are uppercase letters and digits. Requiring a digit keeps all-caps names like GENERAL from looking like IDs.
export const CONVERSATION_ID = /^[CGD](?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/;
export const USER_ID = /^[UW](?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/;
export const SLACK_TS = /^\d+\.\d+$/;
export const PERMALINK = /\/archives\/(?<channel>[A-Z0-9]+)\/p(?<seconds>\d{10})(?<micros>\d{6})/;
// Slack wraps mentions and links in <...>: <@U123>, <#C123|name>, <!here>, <https://url|label>.
export const SPECIAL = /<([^>]+)>/g;
export const USER_MENTION = /<@([UW][A-Z0-9]+)/g;
