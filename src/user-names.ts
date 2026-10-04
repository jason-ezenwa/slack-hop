import { personFrom, type Person } from './person.js';
import type { SlackUser } from './slack-types.js';
import { SlackApiError, type SlackClient } from './slack-client.js';

// Starts each lookup once and shares the pending result with every later caller.
function memo<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let value = cache.get(key);
  if (!value) {
    value = load();
    cache.set(key, value);
  }
  return value;
}

// Lookups degrade to a fallback when Slack refuses (missing scope, deleted user, ...); other errors still throw.
async function orFallback<T>(lookup: Promise<T>, fallback: T): Promise<T> {
  try {
    return await lookup;
  } catch (error) {
    if (error instanceof SlackApiError) return fallback;
    throw error;
  }
}

// Looks up people and bots once each and remembers them for the rest of the command.
export class UserNames {
  private readonly people = new Map<string, Promise<Person>>();
  private readonly bots = new Map<string, Promise<string | undefined>>();
  private readonly dmPartners = new Map<string, Promise<Person | undefined>>();

  constructor(private readonly client: SlackClient) {}

  get(userId: string): Promise<Person> {
    return memo(this.people, userId, () => this.lookup(userId));
  }

  // The name of an integration or bot that posted without a bot profile, e.g. "Jira".
  bot(botId: string): Promise<string | undefined> {
    return memo(this.bots, botId, () => this.lookupBot(botId));
  }

  // The other person in a DM, for labelling DM search results.
  dmPartner(channelId: string): Promise<Person | undefined> {
    return memo(this.dmPartners, channelId, () => this.lookupDmPartner(channelId));
  }

  // One paged users.list call instead of a users.info call per user, for commands that name many people.
  // If it fails, names are looked up one by one as before.
  async loadAll(): Promise<void> {
    try {
      for await (const user of this.client.iterate<SlackUser>('users.list', 'members')) {
        this.people.set(user.id, Promise.resolve(personFrom(user)));
      }
    } catch (error) {
      if (!(error instanceof SlackApiError)) throw error;
    }
  }

  private async lookup(userId: string): Promise<Person> {
    const found = this.client.call<{ user: SlackUser }>('users.info', { user: userId }).then(({ user }) => personFrom(user));
    return orFallback(found, { display: userId });
  }

  private async lookupDmPartner(channelId: string): Promise<Person | undefined> {
    const info = this.client.call<{ channel: { user?: string } }>('conversations.info', { channel: channelId });
    const userId = await orFallback(info.then(({ channel }) => channel.user), undefined);
    return userId ? this.get(userId) : undefined;
  }

  private async lookupBot(botId: string): Promise<string | undefined> {
    const info = this.client.call<{ bot: { name?: string } }>('bots.info', { bot: botId });
    return orFallback(info.then(({ bot }) => bot.name), undefined);
  }
}
