import { requirePositional } from '../command.js';
import { printList } from '../format.js';
import { findUsers } from '../resolve.js';
import { personFrom, personLabel } from '../person.js';
export const findUserCommand = {
    name: 'find-user',
    summary: 'Find people by handle, name or email',
    usage: 'slack-hop find-user <query> --workspace <name>',
    details: [
        'Matches part of the handle, display name, full name or email (email needs the users:read.email scope).',
        'Each match shows: user ID, display name (@handle), full name if different, email.',
        'Example:',
        '  slack-hop find-user jane --workspace client-b',
    ],
    options: {},
    needsWorkspace: true,
    async run({ client, positionals, json }) {
        const users = await findUsers(client, requirePositional(positionals, 0, 'query'));
        await printList(users, json, 'No matching users.', (user) => {
            const person = personFrom(user);
            const realName = user.profile?.real_name || user.real_name;
            const fullName = realName !== person.display ? realName : undefined;
            const bot = user.is_bot ? '(bot)' : undefined;
            return [user.id, personLabel(person), fullName, user.profile?.email, bot].filter(Boolean).join('  ');
        });
    },
};
