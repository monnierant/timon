/**
 * The folder a mission opens in when neither the mission (a task's worktree)
 * nor its agent names one: the folder of its project, the task's project
 * first, else the agent's `project`. Without it such a mission opened in the
 * daemon's own working directory, on a packaged install the release's
 * `resources/orchestrator` folder.
 *
 * A leaf: no database, no file system of its own, so the backends can read
 * `configProject` without pulling `db.ts` in. `agent.ts` wires the registry
 * and the folder check.
 */
import type { AgentConfig } from './agent-config.js';
import { projectFromCwd } from './task-project.js';

export type ProjectFolderInput = {
  /** `task.project` of the task the mission runs. */
  taskProject?: string | null;
  /** `cfg.project` of the agent. */
  agentProject?: string | null;
};

const slugOrNull = (value: string | null | undefined): string | null => {
  const slug = typeof value === 'string' ? value.trim() : '';
  return slug || null;
};

/**
 * The project folder a mission falls back to, or null. The mission's project
 * is the task's, else the agent's; a task project without a folder does not
 * borrow the agent's project folder, which belongs to another project. A
 * folder that cannot be used is not taken: the mission then opens where it
 * did before, rather than being refused a launch that used to run.
 */
export function projectFolderFallback(
  input: ProjectFolderInput,
  folderOf: (slug: string) => string | null | undefined,
  usable: (path: string) => boolean,
): { project: string; folder: string } | null {
  const project = slugOrNull(input.taskProject) ?? slugOrNull(input.agentProject);
  if (!project) return null;
  const folder = slugOrNull(folderOf(project));
  if (!folder || !usable(folder)) return null;
  return { project, folder };
}

/** Configs whose `cwd` is their mission's project folder, not the agent's own. */
const borrowed = new WeakSet<Pick<AgentConfig, 'cwd'>>();

/**
 * Opens the mission of this (per-turn) config in `folder`. The config keeps
 * the mark for as long as it lives, so `configProject` does not read a project
 * off a folder the agent never named.
 */
export function useProjectFolder(cfg: AgentConfig, folder: string): void {
  cfg.cwd = folder;
  borrowed.add(cfg);
}

/**
 * The project a config scopes its mission to (skills, memory, vault slice,
 * `TIMON_PROJECT`, fence): the declared one, else the one its folder names.
 * A folder taken by `useProjectFolder` moves the mission and names no
 * project: the scope stays what it was without a folder. `cwd` is the folder
 * the mission was actually started in, when a provider chose another one.
 */
export function configProject(cfg: Pick<AgentConfig, 'project' | 'cwd'>, cwd: string | undefined = cfg.cwd): string | null {
  if (cfg.project !== undefined && cfg.project !== null) return cfg.project;
  if (borrowed.has(cfg) && cwd === cfg.cwd) return null;
  return projectFromCwd(cwd);
}
