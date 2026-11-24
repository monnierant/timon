/**
 * Timon's own `timon` skill, installed in the home an agent's program runs on.
 *
 * A program with named homes (`RuntimeProfilesStrategy`, a Hermes profile) reads skills from a
 * folder of that home and loads one by name, in a Timon mission and in every other session the
 * same home serves (a session a person opens in the program, a messaging channel). Outside a
 * mission the agent has no Timon tool and no instruction; inside one, the program may rename and
 * defer Timon's MCP tools. The skill tells it both: Timon's tools, under the names the program
 * gives them (the provider's `skills.toolNames`). Not the `timon` CLI: under Hermes 0.23 the
 * terminal of a session runs in a host gateway shared by every session and keeps the environment
 * of the mission that started it, so the `TIMON_*` variables there can be another mission's.
 *
 * Writing into a folder that belongs to another program is the operator's call: nothing happens
 * unless `TIMON_RUNTIME_PROFILE_SKILL` is on. Then, at each launch of a process of such a program:
 *   - no `timon` skill there: Timon writes its own, with a marker (`.timon-skill.json`) holding
 *     the version and a hash of what it wrote;
 *   - Timon's copy, untouched since: rewritten when the text changes (a new Timon version), left
 *     alone otherwise, its mtime included;
 *   - a copy a person edited (the hash differs), or a `timon` skill Timon did not write (no
 *     marker): kept as it is, with one line in the daemon log. Deleting the folder gets Timon's
 *     copy back at the next launch.
 * A failure never stops the launch: the mission runs without the skill.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeProfilesStrategy } from './backends/types.js';
import { timonVersion } from './data-version.js';
import { settingBool } from './settings.js';

export const RUNTIME_PROFILE_SKILL_SETTING = 'TIMON_RUNTIME_PROFILE_SKILL';
/** The folder and the name the program loads the skill by. */
export const TIMON_SKILL_NAME = 'timon';
const MARKER = '.timon-skill.json';

export type TimonSkillInput = { readonly version: string; readonly toolNames: string };
export type SkillInstallOutcome = 'written' | 'updated' | 'unchanged' | 'kept-edited' | 'kept-foreign' | 'failed';
export type SkillInstallResult = { readonly outcome: SkillInstallOutcome; readonly path: string; readonly error?: string };

/** The skill's text. The version is in it, so a new Timon release is a new text. */
export function timonSkillMarkdown({ version, toolNames }: TimonSkillInput): string {
  return `---
name: ${TIMON_SKILL_NAME}
description: "Use when a task involves Timon, the agent orchestrator: its Kanban tasks, missions, other agents, a project's TO DO notebook. Through Timon's MCP tools, never its CLI."
version: ${version}
metadata:
  timon:
    managed: true
---

# Timon

Timon runs AI agents on missions: Kanban tasks, chats, routines. This skill
comes from Timon ${version}. Timon rewrites it when it is updated and leaves
an edited copy alone; delete this folder to get Timon's copy back.

## Are you in a Timon mission?

You are when this session has Timon's tools (below). Timon gives each mission
an MCP server named \`timon\`; a session without it is not a Timon mission (a
session opened directly in this program, a messaging channel): then do not act
on Timon, tell the person what you would need.

## Timon's tools

By short name:

- \`kanban_list\`, \`kanban_add\`, \`kanban_update\`: the Kanban backlog.
- \`kanban_mark_as_done\`, \`kanban_mark_as_failed\`: close the task you were
  started for. A Kanban mission must close its task: nothing else tells Timon
  you are finished.
- \`agent_list\`, \`agent_send_message\`, \`mission_spawn\`: the other agents.
- \`project_todo_list\`, \`project_todo_add\`: a project's TO DO notebook.
- \`docs_search\`, \`docs_read\`: Timon's own documentation.

${toolNames.trim()}

Never guess a full tool name and never reuse one from another session.

## Not the \`timon\` CLI

Do not run the \`timon\` command-line tool from your terminal to act on Timon,
and do not trust the \`TIMON_*\` variables you may find there. A program may
run the terminals of several sessions in one long-lived process: those
variables, its credentials among them, can be another mission's.
`;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

type Marker = { timonVersion?: unknown; sha256?: unknown };

function readMarker(dir: string): Marker | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Marker) : null;
  } catch {
    return null;
  }
}

/** Write next to the target, then rename: a reader never sees half a file. */
function writeAtomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o644 });
  renameSync(temp, path);
}

/** Installs, refreshes or keeps `<skillsDir>/timon/` (see the module's header). Never throws. */
export function installTimonSkill(skillsDir: string, input: TimonSkillInput): SkillInstallResult {
  const dir = join(skillsDir, TIMON_SKILL_NAME);
  const path = join(dir, 'SKILL.md');
  try {
    const wanted = timonSkillMarkdown(input);
    const marker = readMarker(dir);
    let outcome: SkillInstallOutcome = 'written';
    if (marker === null) {
      // Not Timon's: a skill of that name, or anything a person left in the folder.
      if (existsSync(dir) && readdirSync(dir).length > 0) return { outcome: 'kept-foreign', path };
    } else {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (current === null || sha256(current) !== marker.sha256) return { outcome: 'kept-edited', path };
      if (current === wanted) return { outcome: 'unchanged', path };
      outcome = 'updated';
    }
    mkdirSync(dir, { recursive: true });
    writeAtomic(path, wanted);
    writeAtomic(join(dir, MARKER), `${JSON.stringify({ timonVersion: input.version, sha256: sha256(wanted) }, null, 2)}\n`);
    return { outcome, path };
  } catch (err) {
    return { outcome: 'failed', path, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One line per folder and outcome: a kept copy is said once, not at every launch. */
const said = new Set<string>();
function report(result: SkillInstallResult): void {
  if (result.outcome === 'unchanged') return;
  const key = `${result.path}\0${result.outcome}`;
  if (said.has(key)) return;
  said.add(key);
  const line = {
    written: `[runtime-skill] wrote ${result.path}`,
    updated: `[runtime-skill] updated ${result.path} for Timon ${timonVersion()}`,
    'kept-edited': `[runtime-skill] kept ${result.path}: edited since Timon wrote it (delete its folder to get Timon's copy back)`,
    'kept-foreign': `[runtime-skill] kept ${result.path}: a \`${TIMON_SKILL_NAME}\` skill Timon did not write`,
    failed: `[runtime-skill] could not write ${result.path}: ${result.error ?? 'unknown error'}; the mission runs without it`,
  }[result.outcome];
  if (result.outcome === 'written' || result.outcome === 'updated') console.log(line);
  else console.warn(line);
}

export type PrepareDeps = { readonly enabled: () => boolean; readonly version: () => string };
const DEFAULT_DEPS: PrepareDeps = { enabled: () => settingBool(RUNTIME_PROFILE_SKILL_SETTING), version: timonVersion };

/**
 * At a launch: installs the skill in the home the process will run on, when the setting is on
 * and the program names a skills folder for that launch's environment. Null when nothing was
 * attempted. Never throws: a launch never fails on the skill.
 */
export function prepareRuntimeProfileSkill(
  strategy: RuntimeProfilesStrategy | undefined,
  env: Readonly<Record<string, string | undefined>> | undefined,
  deps: PrepareDeps = DEFAULT_DEPS,
): SkillInstallResult | null {
  if (!strategy?.skills || !deps.enabled()) return null;
  let result: SkillInstallResult;
  try {
    const dir = strategy.skills.dir(env ?? {});
    if (!dir) return null;
    result = installTimonSkill(dir, { version: deps.version(), toolNames: strategy.skills.toolNames });
  } catch (err) {
    result = { outcome: 'failed', path: '(skills folder)', error: err instanceof Error ? err.message : String(err) };
  }
  report(result);
  return result;
}
