import { describe, expect, it } from 'vitest';
import { attachmentText, blockText, formatMessage, messageBody, renderText, truncate } from '../src/format.js';
import { personLabel } from '../src/person.js';
import { SlackClient } from '../src/slack-client.js';
import type { SlackBlock } from '../src/slack-types.js';
import { UserNames } from '../src/user-names.js';
import { fakeSlack } from './fake-slack.js';

const SHORT = false;

const names = () =>
  new UserNames(
    new SlackClient(
      'xoxp-1',
      fakeSlack({
        'users.info': (params) =>
          params.get('user') === 'U0000JANE'
            ? { user: { id: 'U0000JANE', name: 'jane.doe', profile: { display_name: 'Jane' } } }
            : { ok: false, error: 'user_not_found' },
        'bots.info': (params) =>
          params.get('bot') === 'B0000JIRA' ? { bot: { name: 'Jira' } } : { ok: false, error: 'bot_not_found' },
      }).fetchFn,
    ),
  );

describe('renderText', () => {
  it('turns Slack markup into readable text', async () => {
    const text =
      'hi <@U0000JANE> and <@U0000NOBODY>, see <#C0123ABCD|eng> and <#C0123ABCD>, <!here>, ' +
      '<!subteam^S0123ABCD|@devs>, <https://example.com|the docs>, <https://example.com> &amp; a &lt;b&gt;';
    expect(await renderText(text, names())).toBe(
      'hi @Jane and @U0000NOBODY, see #eng and #C0123ABCD, @here, ' +
        '@devs, the docs (https://example.com), https://example.com & a <b>',
    );
  });
});

describe('personLabel', () => {
  it('shows the display name with the handle, or just the handle when they match exactly', () => {
    expect(personLabel({ display: 'Jason', handle: 'chukwuemelie.ezenwa' })).toBe('Jason (@chukwuemelie.ezenwa)');
    expect(personLabel({ display: 'jane', handle: 'jane' })).toBe('@jane');
    expect(personLabel({ display: 'Slackbot', handle: 'slackbot' })).toBe('Slackbot (@slackbot)');
    expect(personLabel({ display: 'U0000NOBODY' })).toBe('U0000NOBODY');
  });
});

describe('truncate', () => {
  const cut = (text: string) => truncate(text, { maxLines: 6, maxChars: 400, minHidden: 100 });

  it('leaves short text alone', () => {
    expect(cut('short\nmessage')).toEqual({ shown: 'short\nmessage', hidden: 0 });
  });

  it('shows the whole message when exactly 100 characters would be hidden', () => {
    const text = 'x'.repeat(500);
    expect(cut(text)).toEqual({ shown: text, hidden: 0 });
  });

  it('cuts when 101 characters would be hidden', () => {
    expect(cut('x'.repeat(501))).toEqual({ shown: 'x'.repeat(400), hidden: 101 });
  });

  it('does not let a space at the cut point decide whether to cut', () => {
    const text = `${'x'.repeat(399)} ${'y'.repeat(100)}`;
    expect(cut(text)).toEqual({ shown: text, hidden: 0 });
  });

  it('does not count trailing whitespace', () => {
    const text = `${'x'.repeat(500)}   \n\n  `;
    expect(cut(text)).toEqual({ shown: 'x'.repeat(500), hidden: 0 });
  });

  it('cuts at the line limit when enough is hidden', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${String(i).padStart(2, '0')}`).join('\n');
    const { shown, hidden } = cut(text);
    expect(shown).toBe('line 00\nline 01\nline 02\nline 03\nline 04\nline 05');
    expect(hidden).toBe(text.length - shown.length);
  });

  it('shows a slightly long message in full rather than cutting a few lines', () => {
    const text = Array.from({ length: 8 }, (_, i) => `line ${i}`).join('\n');
    expect(cut(text).hidden).toBe(0);
  });

  it('never splits an emoji', () => {
    const { shown, hidden } = truncate('🎉'.repeat(10), { maxLines: 6, maxChars: 3, minHidden: 0 });
    expect(shown).toBe('🎉🎉🎉');
    expect(hidden).toBe(7);
  });
});

describe('blockText and attachmentText', () => {
  it('reads text from sections, fields, context and rich text', () => {
    const blocks: SlackBlock[] = [
      { type: 'header', text: { text: 'Release' } },
      { type: 'section', text: { text: 'Shipped *v2*' }, fields: [{ text: 'Owner: <@U0000JANE>' }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'via CI' }] },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: 'ping ' },
              { type: 'user', user_id: 'U0000JANE' },
              { type: 'text', text: ' see ' },
              { type: 'link', url: 'https://example.com' },
            ],
          },
        ],
      },
    ];
    expect(blockText(blocks)).toBe('Release\nShipped *v2*\nOwner: <@U0000JANE>\nvia CI\nping <@U0000JANE> see <https://example.com>');
  });

  it('keeps raw characters, emoji, broadcasts and list bullets from rich text', async () => {
    const blocks: SlackBlock[] = [
      {
        type: 'rich_text',
        elements: [
          { type: 'rich_text_section', elements: [{ type: 'broadcast', range: 'here' }, { type: 'text', text: ' if a <b> & c ' }, { type: 'emoji', name: 'tada' }] },
          { type: 'rich_text_list', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'one' }] }, { type: 'rich_text_section', elements: [{ type: 'text', text: 'two' }] }] },
        ],
      },
    ];
    expect(await renderText(blockText(blocks), names())).toBe('@here if a <b> & c :tada:\n• one\n• two');
  });

  it('shows dates and skips malformed or unknown elements instead of failing', () => {
    const blocks = [
      {
        type: 'rich_text',
        elements: [
          { type: 'rich_text_section', elements: [{ type: 'text', text: 'due ' }, { type: 'date', fallback: 'Oct 1' }, { type: 'text' }, { type: 'image' }] },
          { type: 'rich_text_section' },
        ],
      },
    ] as unknown as SlackBlock[];
    expect(blockText(blocks)).toBe('due Oct 1');
  });

  it('reads an integration attachment, falling back to its summary', () => {
    expect(
      attachmentText({ pretext: 'Issue created', title: 'PROJ-12 Fix login', text: 'Users cannot log in', fields: [{ title: 'Priority', value: 'High' }] }),
    ).toBe('Issue created\nPROJ-12 Fix login\nUsers cannot log in\nPriority: High');
    expect(attachmentText({ fallback: 'PROJ-12 Fix login' })).toBe('PROJ-12 Fix login');
  });
});

describe('formatMessage', () => {
  it('shows time, author with handle, text, files and reply count', async () => {
    const message = { ts: '1790812800.000100', user: 'U0000JANE', text: 'report', reply_count: 3, files: [{ name: 'q3.pdf' }] };
    expect(await formatMessage(message, names(), SHORT)).toBe(
      '[2026-10-01 00:00 UTC] Jane (@jane.doe): report\n[file: q3.pdf]\n    (ts 1790812800.000100, 3 replies)',
    );
  });

  it('names a bot from its profile, or looks it up by ID', async () => {
    const withProfile = { ts: '1790812800.000100', bot_profile: { name: 'Deploy Bot' }, text: 'done' };
    expect(await formatMessage(withProfile, names(), SHORT)).toContain('] Deploy Bot: done');
    const withId = { ts: '1790812800.000100', bot_id: 'B0000JIRA', text: 'new ticket' };
    expect(await formatMessage(withId, names(), SHORT)).toContain('] Jira: new ticket');
    const unknown = { ts: '1790812800.000100', bot_id: 'B0000GONE', text: 'hi' };
    expect(await formatMessage(unknown, names(), SHORT)).toContain('] unknown: hi');
  });

  it('shows integration content when the message text is empty', async () => {
    const message = {
      ts: '1790812800.000100',
      bot_id: 'B0000JIRA',
      text: '',
      attachments: [{ title: 'PROJ-12 Fix login', text: 'Assigned to <@U0000JANE>' }],
    };
    expect(await formatMessage(message, names(), SHORT)).toContain('] Jira: PROJ-12 Fix login\nAssigned to @Jane');
  });

  it('uses blocks when the message text is empty', async () => {
    const message = { ts: '1790812800.000100', text: '', blocks: [{ type: 'section', text: { text: 'New feedback submitted: slow login' } }] };
    expect(await formatMessage(message, names(), SHORT)).toContain(': New feedback submitted: slow login');
  });

  it('shows a bot\'s blocks instead of its summary text, as Slack does', async () => {
    const message = {
      ts: '1790812800.000100',
      bot_id: 'B0000JIRA',
      text: 'New feedback submitted',
      blocks: [
        { type: 'header', text: { text: 'New feedback submitted' } },
        { type: 'section', text: { text: 'The essay editor is great' }, fields: [{ text: 'Satisfaction: 10 / 10' }] },
      ],
    };
    expect(await messageBody(message, names(), SHORT)).toBe('New feedback submitted\nThe essay editor is great\nSatisfaction: 10 / 10');
  });

  it('keeps a bot\'s summary when its blocks only add a footer', async () => {
    const message = {
      ts: '1790812800.000100',
      bot_id: 'B0000JIRA',
      text: 'Build 512 failed on main',
      blocks: [{ type: 'context', elements: [{ type: 'mrkdwn' as const, text: 'via CI' }] }],
    };
    expect(await messageBody(message, names(), SHORT)).toBe('Build 512 failed on main\nvia CI');
  });

  it('keeps < and > in plain-text block headers', async () => {
    const message = { ts: '1790812800.000100', text: 'summary', blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Use <Button> & co' } }] };
    expect(await messageBody(message, names(), SHORT)).toBe('summary\nUse <Button> & co');
  });

  it('keeps a person\'s text when their blocks are only a rich-text copy of it', async () => {
    const blocks: SlackBlock[] = [
      { type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'see the docs' }] }] },
    ];
    const message = { ts: '1790812800.000100', user: 'U0000JANE', text: 'see <https://example.com|the docs>', blocks };
    expect(await messageBody(message, names(), SHORT)).toBe('see the docs (https://example.com)');
  });

  it('keeps a shared message when the person added a comment', async () => {
    const message = {
      ts: '1790812800.000100',
      user: 'U0000JANE',
      text: 'FYI',
      attachments: [{ from_url: 'https://acme.slack.com/archives/C1/p1', is_share: true, author_name: 'Sam', text: 'The release moved to Friday' }],
    };
    expect(await messageBody(message, names(), SHORT)).toBe('FYI\n[shared message from Sam]\nThe release moved to Friday');
  });

  it('always shows file markers, even when the text is shortened', async () => {
    const message = { ts: '1790812800.000100', user: 'U0000JANE', text: 'x'.repeat(600), files: [{ name: 'contract.pdf' }] };
    const body = await messageBody(message, names(), SHORT);
    expect(body).toMatch(/… \[200 more characters, --full shows all\]\n\[file: contract\.pdf\]$/);
  });

  it('shows whole messages when full is set', async () => {
    const message = { ts: '1790812800.000100', user: 'U0000JANE', text: 'x'.repeat(900) };
    expect(await messageBody(message, names(), true)).toBe('x'.repeat(900));
  });

  it('skips link previews when the message has its own text', async () => {
    const message = {
      ts: '1790812800.000100',
      user: 'U0000JANE',
      text: 'look at <https://example.com>',
      attachments: [{ from_url: 'https://example.com', title: 'Example Domain', text: 'preview text' }],
    };
    expect(await formatMessage(message, names(), SHORT)).toContain(': look at https://example.com\n    (ts');
  });
});
