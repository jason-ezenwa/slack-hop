import type { SlackUser } from './slack-types.js';

// `handle` is missing only when a user could not be looked up and all we have is their ID.
export type Person = { display: string; handle?: string };

export function personFrom(user: SlackUser): Person {
  return { display: user.profile?.display_name || user.real_name || user.name, handle: user.name };
}

// "Jason (@chukwuemelie.ezenwa)", or just "@jason" when the display name is exactly the handle.
// Names that differ only in capitals ("Slackbot" and "slackbot") still show both.
export function personLabel(person: Person): string {
  if (!person.handle) return person.display;
  if (person.display === person.handle) return `@${person.handle}`;
  return `${person.display} (@${person.handle})`;
}
