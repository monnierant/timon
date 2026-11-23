/**
 * A mission whose agent has no folder, and that has none of its own, opens in
 * the folder of its project: the task's project, else the agent's `project`.
 * The agent's folder and a task's worktree keep their precedence, and a
 * mission with no project opens where it did before (the daemon's own folder).
 * The fallback moves the mission only: the project it is scoped to
 * (`TIMON_PROJECT`, vault, memory, skills) stays what it was without it.
 *
 * A fake host whose `spawn` runs nothing, throwaway TIMON_HOME.
 */
import './test-home.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

process.env.TIMON_RESOURCE_GUARD_ENABLED = '0';

const { getHost } = await import('./host/index.js');
await import('../tests/helpers/claude-provider.js');
const { spawnAgent, upsertAgent } = await import('./agent.js');
const { dbApi } = await import('./db.js');

type FakeChild = ChildProcessWithoutNullStreams & { killed: boolean };

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4243;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = ((signal?: NodeJS.Signals | number) => {
    child.killed = true;
    child.emit('exit', 0, signal ?? null);
    child.emit('close', 0, signal ?? null);
    return true;
  }) as ChildProcessWithoutNullStreams['kill'];
  return child;
}

// The folders carry a `projects/<name>` marker that is NOT their project's slug:
// a scope read off the path would show up as that name.
const root = mkdtempSync(join(tmpdir(), 'timon-project-folder-'));
after(() => rmSync(root, { recursive: true, force: true }));
const folder = (name: string): string => {
  const path = join(root, 'projects', name);
  mkdirSync(path, { recursive: true });
  return path;
};
const alphaFolder = folder('alpha-repo');
const betaFolder = folder('beta-repo');
const agentFolder = folder('agent-own');
const worktree = folder('worktree-of-task');
dbApi.upsertProject('alpha', { name: 'Alpha', cwd: alphaFolder });
dbApi.upsertProject('beta', { name: 'Beta', cwd: betaFolder });
dbApi.upsertProject('bare', { name: 'Bare' });
dbApi.upsertProject('gone', { name: 'Gone', cwd: join(root, 'projects', 'gone-repo') });

function agent(name: string, config: { cwd?: string; project?: string } = {}): string {
  upsertAgent({
    name,
    system_prompt: 'project folder witness: does nothing.',
    config: { backend: 'claude', skills: [], mcp_servers: [], memory_scope: 'NONE', ...config },
  });
  return name;
}

function taskOf(project: string | null, agentName: string): string {
  const id = randomUUID();
  dbApi.createTask(id, 'folder witness', agentName, { type: 'chore', project });
  return id;
}

/** Launches one mission behind a fake spawn and returns where it was started and with which env. */
async function launch(
  agentName: string,
  opts: { taskId?: string; cwdOverride?: string } = {},
): Promise<{ cwd: string | undefined; env: NodeJS.ProcessEnv }> {
  const host = getHost();
  const original = host.spawn;
  const calls: { cwd: string | undefined; env: NodeJS.ProcessEnv }[] = [];
  const children: FakeChild[] = [];
  host.spawn = ((_cmd: string, _args: string[], spawnOpts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    const child = fakeChild();
    children.push(child);
    calls.push({ cwd: spawnOpts?.cwd, env: (spawnOpts?.env ?? {}) as NodeJS.ProcessEnv });
    return child;
  }) as typeof host.spawn;
  try {
    const source = opts.taskId ? { channel: 'dispatcher', meta: { task_id: opts.taskId } } : undefined;
    await spawnAgent(agentName, 'ping', source, opts.cwdOverride ? { cwdOverride: opts.cwdOverride } : {});
    assert.equal(calls.length, 1, 'a single spawn, through the host');
    return calls[0]!;
  } finally {
    host.spawn = original;
    for (const child of children) if (!child.killed) child.kill();
  }
}

test('an agent without a folder opens a task mission in the task\'s project folder', async () => {
  const name = agent('folder-none-task');
  const { cwd, env } = await launch(name, { taskId: taskOf('alpha', name) });
  assert.equal(cwd, alphaFolder);
  assert.equal(env.TIMON_PROJECT, '', 'the scope is not read off the borrowed folder');
});

test('without a task project, the agent\'s project folder is used', async () => {
  const name = agent('folder-none-agent-project', { project: 'beta' });
  const { cwd, env } = await launch(name);
  assert.equal(cwd, betaFolder);
  assert.equal(env.TIMON_PROJECT, 'beta', 'a declared project is the scope, as before');
});

test('the task\'s project wins over the agent\'s', async () => {
  const name = agent('folder-none-both', { project: 'beta' });
  const { cwd } = await launch(name, { taskId: taskOf('alpha', name) });
  assert.equal(cwd, alphaFolder);
});

test('the agent\'s own folder keeps its precedence', async () => {
  const name = agent('folder-own', { project: 'beta', cwd: agentFolder });
  const { cwd } = await launch(name, { taskId: taskOf('alpha', name) });
  assert.equal(cwd, agentFolder);
});

test('a task\'s worktree keeps its precedence', async () => {
  const name = agent('folder-worktree');
  const { cwd } = await launch(name, { taskId: taskOf('alpha', name), cwdOverride: worktree });
  assert.equal(cwd, worktree);
});

test('a mission with no project opens where it did before', async () => {
  const name = agent('folder-no-project');
  assert.equal((await launch(name)).cwd, process.cwd());
  assert.equal((await launch(name, { taskId: taskOf(null, name) })).cwd, process.cwd());
});

test('a project with no folder, or a folder that is gone, changes nothing', async () => {
  const name = agent('folder-bare', { project: 'beta' });
  // The task's project has no folder: the agent's project folder is not borrowed.
  assert.equal((await launch(name, { taskId: taskOf('bare', name) })).cwd, process.cwd());
  // A registered folder that is gone does not refuse a launch that ran before.
  assert.equal((await launch(name, { taskId: taskOf('gone', name) })).cwd, process.cwd());
});
