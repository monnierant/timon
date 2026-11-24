# Hermes Gateway

Makes the Hermes agents of a user's own **Hermes gateway** (its API server,
Hermes 0.21.0 or later) answer in Timon like any other agent: chat, missions,
Kanban tasks other than `code` (unless its connection turns on the remote
tools below, the agent has no Timon tools, so the daemon auto-closes such a
task once its mission goes idle). The gateway may run on another machine.

This package is standalone: it uses only the public plugin SDK (`apiVersion`
7) and imports nothing from Timon's daemon or app. It is not preinstalled.

## Install

```sh
timon plugin add ./plugins/hermes-gateway
```

The package includes its compiled `lib/` files; installing it builds nothing.
User documentation: `public-docs/docs/usage/hermes-gateway.md`.

## What it uses from the SDK

| Piece | API | Permission |
|---|---|---|
| Remote dialect `hermes-gateway` and its profile (model `hermes/<profile>` or `hermes/<connectionId>/<profile>`) | `ctx.backends.registerDialect` / `registerProfile` (`transport: 'remote'`, `capabilities`) | `backends:register` |
| Connection type `hermes-gateway:gateway@1` (URL, optional profile, optional Timon address, `apiKey` in the vault) with its Test | `ctx.connections.registerType` | `connections:register` |
| The connection and key of the account that launches the mission | `ctx.connections.forUser` / `userSecret` | `connections:users:read` |
| Calls to the approved gateway, through the daemon's SSRF guard | `ctx.fetch` | `http:outbound` |
| « Add my Hermes agents to Timon »: one Timon agent per connected profile, or per connection when several gateways serve it (nothing is created on the gateway) | `ctx.agents` | `agents:manage` |
| A remote MCP token per turn, when the connection gives a Timon address | `ctx.mcp.issueToken` / `revokeToken` | `mcp:issue` |
| Settings category with the gateways' state | slot `settings.section` | — |

## Which gateway a mission reaches

The agent's model says it; `src/connection.ts` (`parseModel`, `pickConnection`)
reads it, and the settings' `/status` route uses the same rule to name the
agents behind each gateway.

| Model | Agent | Reaches |
|---|---|---|
| `hermes/<profile>` | `hermes.<profile>` | **Shared door**: the first usable connection of the launching account that serves `<profile>`. Each account reaches its own gateway. |
| `hermes/<connectionId>/<profile>` | `hermes.<label>.<profile>` | **Pinned**: that connection only, if the launching account owns it and it still serves `<profile>`. |

A profile name never holds a `/`, so the two forms cannot be confused, and a
model written before pinned models existed resolves exactly as it did. The
model carries the connection's id, never its URL or key. A pinned agent
launched by another account, or whose connection was deleted, fails with one
message that never says which (the existence of someone else's connection is
not disclosed); a connection whose profile changed says so and asks for the
agents to be created again.

`syncAgents` (the « Add my Hermes agents » button) creates the door agent for a
profile only one of the caller's usable connections serves, and one pinned
agent per connection for a profile several serve. It never renames nor
re-points an existing door agent, and never re-points an agent pinned to a
connection the caller does not hold: when `hermes.<label>.<profile>` is taken,
the name takes the first 8 characters of the connection id
(`hermes.<label>-<id>.<profile>`). A pinned agent is found again by its model
first, so relabelling a connection keeps its agent.

## How a turn runs

One mission is one Hermes session (`session_id` = the mission's resume id),
one turn is one Hermes run:

- `POST /v1/runs` with an `Idempotency-Key`, reused on every retry (network
  error, 5xx, 429 with `Retry-After`), and `X-Hermes-Session-Key: timon:<account>`;
- the run's events (`GET /v1/runs/{id}/events`) map to Timon's vocabulary:
  `message.delta` → `assistant_delta`, `tool.started/completed` →
  `tool_use/tool_result` (paired in order per tool name), `subagent.*` →
  `hermes_subagent` cards, `message.interim` → a persisted message,
  `run.*` → `result`. `reasoning.available` carries the assistant's text,
  not reasoning: it is never shown as thinking;
- a watchdog (120 s without an event; keepalives prove the socket alive, not
  progress) and every unexpected end of the stream hand over to
  `GET /v1/runs/{id}`, which decides how the turn ended;
- `approval.request` → the product's Allow/Deny card → `once` or `deny`,
  answered by `request_id`, deduplicated, dropped once the run ended;
- STOP → `POST /v1/runs/{id}/stop`; closing the session stops the run too.

Two stream modes, detected on the first frame (no capability flag says it):
from Hermes 0.21.6 frames carry `id:` and a cut stream resumes with
`Last-Event-ID`; before it, a reconnection answers 404 and the turn polls the
run status for its final answer. After a daemon restart the driver reattaches
to its run from `{ runId, sessionId, lastSeq }` and raises a pending approval
card again.

## The way back to Timon

A Hermes run takes no MCP server, header or environment from its caller: its
`instructions` are the only thing Timon writes per run. `src/way-back.ts`
builds what goes there, after the agent's own instructions:

- **always**, the mission id and the agent's name (not secrets). An agent on
  the same host as Timon reaches it with the host's own tools and names its
  mission with this id;
- **when the connection gives a Timon address** (`timonUrl`, empty by
  default), a remote MCP token issued for that turn (`ctx.mcp.issueToken`),
  limited to `kanban_mark_as_done`, `kanban_mark_as_failed`,
  `agent_send_message` and `agent_list`, with the address, the path
  (`/api/remote-mcp`) and a short JSON-RPC how-to. The token is revoked when
  the turn ends (answer, failure, STOP, closed session; after a daemon
  restart, from the token's id kept in the resume state) and dies with the
  mission anyway (24 h at most). A token that cannot be issued leaves the run
  without it and says so in the thread.

Nothing goes through an environment variable: Hermes runs the terminal of
every session in one shared gateway process, whose `TIMON_*` variables belong
to whichever mission started it. The instructions tell the agent to ignore
them.

The token is written into the run: the remote Hermes keeps it in that
session's transcript, and Timon never logs it nor saves it (the resume state
holds its id only). This is why the remote tools are an opt-in of the
connection; Timon never calls the address, it only writes it.

## Develop

```sh
cd plugins/hermes-gateway
../../orchestrator/node_modules/.bin/esbuild src/index.ts --bundle --platform=node --format=esm --outfile=lib/index.js
../../orchestrator/node_modules/.bin/esbuild src/client.tsx --bundle --format=esm --external:react --external:@timon/ui --outfile=lib/client.js
node ../../orchestrator/node_modules/typescript/bin/tsc -p tsconfig.json
cd ../../orchestrator && npm test -- src/plugins/hermes-gateway.test.ts src/plugins/hermes-gateway-package.test.ts
```

The tests run against `test/fake-gateway.mjs`, a Node HTTP server that replays
the frames measured on Hermes on 10/10/2026 (`test/__fixtures__`), as Hermes
0.21.0 and as 0.21.6. No network, no Python. Commit the rebuilt `lib/` files
together with their sources.

## Credits

The way a run is followed is ported from the gateway client of
[Hermes Web UI](https://github.com/nesquena/hermes-webui) (`api/gateway_chat.py`,
MIT). See `NOTICE`.
