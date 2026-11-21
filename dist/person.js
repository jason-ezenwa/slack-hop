export function personFrom(user) {
    return { display: user.profile?.display_name || user.real_name || user.name, handle: user.name };
}
// "Jane (@jane.doe)", or just "@jane" when the display name matches the handle exactly, capitals included.
export function personLabel(person) {
    if (!person.handle)
        return person.display;
    if (person.display === person.handle)
        return `@${person.handle}`;
    return `${person.display} (@${person.handle})`;
}
