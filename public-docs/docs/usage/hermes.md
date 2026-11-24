---
title: Hermes
sidebar_position: 12
---

Timon can run agents on **Hermes**, the agent from Nous Research. It drives the `hermes-acp` command over the Agent Client Protocol; Hermes keeps its own sign-in, and Timon never sees or stores it.

If your Hermes runs as a gateway, possibly on another machine, see [Hermes Gateway](./hermes-gateway.md) instead.

## Set it up

1. Install Hermes Agent by following Hermes' own documentation. What Timon needs is the `hermes-acp` command, reachable by the OS account that runs Timon.
2. Sign in, in a terminal, under that same account:

   ```bash
   hermes setup
   ```

   With a Nous Portal subscription, `hermes portal` signs in to Nous and picks a model in one step. On Windows, if `hermes` is not on your PATH, run `%LOCALAPPDATA%\hermes\bin\hermes.exe setup`. The **Sign in** button of the Hermes card, in the onboarding and in **Settings › AI models › Providers**, copies this command with the path Timon found. Do not start `hermes-acp` yourself to sign in: Timon starts it, and run by hand it opens nothing and only waits.

3. Restart Timon. **Hermes** then appears in the model selectors.

Timon looks for `hermes-acp` on the service's PATH, in `~/.local/bin` on Linux and macOS, and in `%LOCALAPPDATA%\hermes\bin` on Windows, which is where Hermes' installer puts it.

If Hermes does not appear, run `timon doctor`: it tells you whether the `hermes-acp` binary was found. A CLI installed anywhere else may be missing from the service's PATH; set `host.binaries.hermes-acp` to its absolute path in that case. If a mission stops with "sign in first", run `hermes setup` (or `hermes portal` for Nous) in a terminal on the machine that runs Timon (not `hermes-acp`, which only waits), then start the mission again.

## Models

Timon does not pick a model for Hermes: the default is Hermes' own. The model picker lists what your Hermes account offers — dozens of models on some accounts — and you can search it. The list is asked from Hermes and refreshed at most every 12 hours; opening it starts Hermes briefly, which leaves one empty session in Hermes' own history. A model change applies from the next session.

## Hermes profiles

Hermes can keep several profiles on one machine (`hermes profile create work`), each with its own configuration, model providers, keys, skills and sessions. A Timon agent can run on one of them: in the agent editor, the **LLM** tab of a Hermes agent has a **Hermes profile** field that lists the profiles of the machine that runs Timon. Leave it empty to run on Hermes' default profile, as before.

- The agent's missions start Hermes on that profile, the same way `hermes --profile <name>` does. Timon reads the profile names and writes nothing into a profile, except the `timon` skill below when you turn it on: create, edit and delete profiles with Hermes.
- The model picker of that agent shows the models that profile offers, asked from Hermes on that profile and kept apart from the default profile's list. The list stops at 60 models; when a profile offers more, the picker's search still finds the others, and you can save any of them. Without a model, the agent runs on the profile's own default model.
- Several agents can share a profile, and two agents on two profiles each see their own list.
- Changing an agent's profile, back to the default included, needs the same permission as changing its backend: an administrator, or a user granted the agent's privileged settings. The name must be one of the profiles Hermes lists on the machine.
- A profile that has been deleted since stays on the agent, marked as missing: its missions do not start until you pick another profile or the default.

Timon finds the profiles where Hermes keeps them: under `~/.hermes/profiles` (`%LOCALAPPDATA%\hermes\profiles` on Windows), or under the `HERMES_HOME` the service runs with. A [Hermes Gateway](./hermes-gateway.md) backend has no profile field: the gateway runs on the profile it was started with.

## The `timon` skill

Turn on **Install the timon skill in agents' program homes** (`TIMON_RUNTIME_PROFILE_SKILL`, in **Settings**, off by default) and Timon writes a `timon` skill into the Hermes home each Hermes agent runs on: `skills/timon/` of the agent's profile, or of Hermes' default home when the agent names no profile. Hermes then lists it and loads it by name (`skill_view`), in a Timon mission and in any other session of that home.

- The skill tells the agent how to tell a Timon mission from another session, which Timon tools to use, and how Hermes names them: `mcp__editor_timon_<8 hex>__<tool>`, a name that changes with each session, often to be found with `tool_search` first. It names no full tool name.
- It does not send the agent to the `timon` command line. Hermes 0.23 runs the terminal of every session in one shared process, which keeps the environment of the mission that started it: a later mission's terminal holds the first mission's `TIMON_*` variables and token.
- Timon writes it at the start of a mission, rewrites it when Timon is updated, and leaves it alone otherwise. A copy you edited, or a `timon` skill Timon did not write, stays as it is; delete the `skills/timon` folder to get Timon's copy back.
- Turning the setting off stops the writes; a skill already written stays until you delete it.

## What agents can do

Hermes **asks before it uses a tool**. The request appears as an **Allow / Deny** card, like on the other backends: **Allow** lets that one action through, **Deny** refuses it and Hermes carries on without it. When Hermes offers it, **Allow for this session** or **Always allow** lets Hermes remember the approval on its side; nothing is allowed wider unless you click one of them. On an autonomous mission with nobody to answer, a card left open ends in a refusal after the usual delay.

Replies stream into the chat, tool calls appear with their results, and Hermes' reasoning — which can be long — shows as a single collapsed **Reasoning** block. **Stop** in a chat ends the current turn and keeps the conversation. After a restart, the mission reopens its Hermes session without replaying the old messages. Timon's own tools (Kanban, questions, missions, memory) and the stdio MCP servers configured for the agent reach Hermes.

The commands a Hermes agent runs in its terminal carry no mission identity: Hermes runs the terminal of all its sessions in one background process, which outlives the mission that started it, so what identified that mission would reach the next ones. The `timon` command there refuses to act and points to Timon's tools, which a Hermes agent uses instead; it never falls back to your own access. The agent's connections are not listed per mission in [Network activity](network-activity.md) either.

**Compacting a conversation** and its summary when you switch it to another model run on the agent's own model, as does Dreaming for a Hermes agent: Timon starts Hermes for a short session with none of Timon's tools, then stops it. Each run leaves one session in Hermes' own history. Tool requests Hermes makes during it are refused. Conversation titles are not generated with Hermes: Timon uses another of your backends, or keeps the first message as the title.

## Limitations

- **No answer in a fenced mission on Linux.** Hermes does its work (the model, its tools, the commands it runs) in a background process of its own, its gateway, which it starts and reaches through a Unix socket. The [mission fence](mission-isolation.md) refuses Unix sockets, so a fenced Hermes mission stops with "Gateway could not start". Timon does not start that gateway outside the fence for you: everything Hermes does would then run unfenced. To use Hermes in a fenced mission, add an exception that allows Unix sockets for its agent ([Exceptions](mission-isolation.md#exceptions)). Know what it opens: the mission reaches every Unix socket of your session, and if a Hermes gateway is already running for your account (the Hermes app, its terminal interface or its scheduled jobs started it), the mission uses that one, outside the fence. [Hermes Gateway](hermes-gateway.md) is the other way: it talks over HTTP to a gateway you start yourself, which the fence never covers either. Windows missions are not fenced, so Hermes is not affected there; macOS has not been checked yet.
- **Not yet tried on a tester's own account.** Timon was checked against the Hermes agent and a scripted stand-in, not a full session on your Nous account, so a first mission may still fail. Report what you see.
- **HTTP MCP servers are not passed on.** MCP servers you added over HTTP do not reach Hermes agents.
- **No live model switch.** A model change applies from the next session.
- **No quota gauge.** Timon does not display your remaining usage.
