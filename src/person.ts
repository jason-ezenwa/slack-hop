import type { SlackUser } from './slack/slack-types.js';
import type { Person } from './types.js';

export function personFrom(user: SlackUser): Person {
  return { display: user.profile?.display_name || user.real_name || user.name, handle: user.name };
}

// "Jane (@jane.doe)", or just "@jane" when the display name matches the handle exactly, capitals included.
export function personLabel(person: Person): string {
  if (!person.handle) return person.display;
  if (person.display === person.handle) return `@${person.handle}`;
  return `${person.display} (@${person.handle})`;
}
