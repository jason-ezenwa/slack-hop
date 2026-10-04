import { personFrom } from './person.js';
import { SlackApiError } from './slack-client.js';
// Starts each lookup once and shares the pending result with every later caller.
function memo(cache, key, load) {
    let value = cache.get(key);
    if (!value) {
        value = load();
        cache.set(key, value);
    }
    return value;
}
// Lookups degrade to a fallback when Slack refuses (missing scope, deleted user, ...); other errors still throw.
async function orFallback(lookup, fallback) {
    try {
        return await lookup;
    }
    catch (error) {
        if (error instanceof SlackApiError)
            return fallback;
        throw error;
    }
}
// Looks up people and bots once each and remembers them for the rest of the command.
export class UserNames {
    client;
    people = new Map();
    bots = new Map();
    dmPartners = new Map();
    constructor(client) {
        this.client = client;
    }
    get(userId) {
        return memo(this.people, userId, () => this.lookup(userId));
    }
    // The name of an integration or bot that posted without a bot profile, e.g. "Jira".
    bot(botId) {
        return memo(this.bots, botId, () => this.lookupBot(botId));
    }
    // The other person in a DM, for labelling DM search results.
    dmPartner(channelId) {
        return memo(this.dmPartners, channelId, () => this.lookupDmPartner(channelId));
    }
    // One paged users.list call instead of a users.info call per user, for commands that name many people.
    // If it fails, names are looked up one by one as before.
    async loadAll() {
        try {
            for await (const user of this.client.iterate('users.list', 'members')) {
                this.people.set(user.id, Promise.resolve(personFrom(user)));
            }
        }
        catch (error) {
            if (!(error instanceof SlackApiError))
                throw error;
        }
    }
    async lookup(userId) {
        const found = this.client.call('users.info', { user: userId }).then(({ user }) => personFrom(user));
        return orFallback(found, { display: userId });
    }
    async lookupDmPartner(channelId) {
        const info = this.client.call('conversations.info', { channel: channelId });
        const userId = await orFallback(info.then(({ channel }) => channel.user), undefined);
        return userId ? this.get(userId) : undefined;
    }
    async lookupBot(botId) {
        const info = this.client.call('bots.info', { bot: botId });
        return orFallback(info.then(({ bot }) => bot.name), undefined);
    }
}
