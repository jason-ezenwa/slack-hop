import type { Command } from '../command.js';
import { printList } from '../format.js';
import { configuredWorkspaces, resolveToken, SlackApiError, SlackClient } from '../slack-client.js';

type AuthTest = { team: string; user: string; url: string };
type WorkspaceStatus =
  | { workspace: string; status: 'ok'; team: string; user: string; url: string }
  | { workspace: string; status: 'rejected'; error: string };

export const workspacesCommand: Command = {
  name: 'workspaces',
  summary: 'List configured workspaces and check each token',
  usage: 'slack-hop workspaces',
  details: [
    'Finds every SLACK_TOKEN_* environment variable and asks Slack who each token belongs to.',
    'SLACK_TOKEN_CLIENT_B is used with --workspace client-b.',
  ],
  options: {},
  needsWorkspace: false,
  async run({ env, json }) {
    const statuses = await Promise.all(
      configuredWorkspaces(env).map(async (workspace): Promise<WorkspaceStatus> => {
        try {
          const auth = await new SlackClient(resolveToken(workspace, env)).call<AuthTest>('auth.test');
          return { workspace, status: 'ok', team: auth.team, user: auth.user, url: auth.url };
        } catch (error) {
          if (error instanceof SlackApiError) return { workspace, status: 'rejected', error: error.code };
          throw error;
        }
      }),
    );

    await printList(
      statuses,
      json,
      'No workspaces configured. Add a token as SLACK_TOKEN_<NAME>, e.g. SLACK_TOKEN_CLIENT_B.',
      (status) =>
        status.status === 'ok'
          ? `${status.workspace}: ${status.team} as @${status.user} (${status.url})`
          : `${status.workspace}: token rejected (${status.error})`,
    );
  },
};
