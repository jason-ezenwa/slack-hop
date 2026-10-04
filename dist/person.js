export function personFrom(user) {
    return { display: user.profile?.display_name || user.real_name || user.name, handle: user.name };
}
// "Jason (@chukwuemelie.ezenwa)", or just "@jason" when the display name is exactly the handle.
// Names that differ only in capitals ("Slackbot" and "slackbot") still show both.
export function personLabel(person) {
    if (!person.handle)
        return person.display;
    if (person.display === person.handle)
        return `@${person.handle}`;
    return `${person.display} (@${person.handle})`;
}
