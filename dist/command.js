import { UsageError } from './slack-client.js';
// Shared by the commands that print messages.
export const FULL_OPTION = { full: { type: 'boolean' } };
export const FULL_HELP = '  --full    Show whole messages (long ones are shortened by default)';
export function wantsFull(options) {
    return options.full === true;
}
export function limitHelp(noun, spec) {
    return `  --limit   Maximum ${noun}, 1-${spec.max} (default: ${spec.fallback})`;
}
export function parseLimit(value, spec) {
    if (value === undefined)
        return spec.fallback;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > spec.max) {
        throw new UsageError(`--limit must be a whole number from 1 to ${spec.max}.`);
    }
    return limit;
}
export function requirePositional(positionals, index, name) {
    const value = positionals[index];
    if (!value)
        throw new UsageError(`Missing <${name}>.`);
    return value;
}
export function optionalString(value) {
    return typeof value === 'string' ? value : undefined;
}
