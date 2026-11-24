/**
 * The way back to Timon for an agent on a Hermes gateway. A Hermes run takes
 * no MCP server, no header and no environment from its caller: the only
 * channel per run is its `instructions` text. So:
 *
 *  - every run names its mission (not a secret), for an agent on the same host
 *    as Timon that reaches it with the host's own tools;
 *  - when the connection gives a Timon address (off by default), every turn
 *    also carries a remote MCP token (`ctx.mcp.issueToken`), limited to the
 *    tools below and revoked when the turn ends, with a short how-to.
 *
 * The token then sits in the remote Hermes' transcript of that run: this is
 * why the second part is an opt-in of the connection.
 *
 * Nothing here reads an environment variable: Hermes runs the terminal of
 * every session in one shared process, whose `TIMON_*` variables (if any)
 * belong to whichever mission started it, not to this run.
 */

/** What a gateway agent needs to report back: close its task, or talk to another agent. */
export const REMOTE_TOOLS: readonly string[] = Object.freeze([
  'kanban_mark_as_done',
  'kanban_mark_as_failed',
  'agent_send_message',
  'agent_list',
]);

/** The longest a token may live; it is revoked as soon as its turn ends anyway. */
export const TOKEN_TTL_MS = 24 * 60 * 60_000;

/** `ctx.mcp`, as the driver uses it. */
export type McpIssuer = {
  issueToken(input: { missionId: string; scopes: readonly string[]; ttl?: number }): Promise<{ id: string; token: string; path: string }>;
  revokeToken(id: string): Promise<boolean>;
};

/** The block every run carries: which mission it belongs to. */
export function missionBlock(missionId: string, agentName: string | null): string {
  const agent = agentName ? `, agent \`${agentName}\`` : '';
  return [
    '## Timon',
    `This run belongs to Timon mission \`${missionId}\`${agent}.`,
    'When a Timon tool or command asks for your mission, use this id. '
      + 'Do not trust a TIMON_MISSION_ID variable in your terminal: it may belong to another mission.',
  ].join('\n');
}

/** The connection's address plus the endpoint's path, with one slash between them. */
export function endpointUrl(timonUrl: string, path: string): string {
  return `${timonUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** The how-to for the remote MCP endpoint, with this turn's token. */
export function remoteToolsBlock(url: string, token: string, tools: readonly string[] = REMOTE_TOOLS): string {
  return [
    '### Timon tools over HTTP',
    `During this run you can call these Timon tools: ${tools.join(', ')}. `
      + 'Use them to report back: close your task with a result (kanban_mark_as_done) or as failed (kanban_mark_as_failed), '
      + 'or write to another agent (agent_send_message).',
    `- Endpoint: POST ${url}`,
    `- Headers: Authorization: Bearer ${token}`,
    '  Content-Type: application/json',
    '  Accept: application/json',
    '- Body: one JSON-RPC 2.0 message. `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` lists the tools and their arguments; '
      + '`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}` calls one.',
    `- From a shell: curl -sS -X POST '${url}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' `
      + `-H 'Accept: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
    'The token works for this run only. Keep it out of files, commits, messages and URLs.',
  ].join('\n');
}
