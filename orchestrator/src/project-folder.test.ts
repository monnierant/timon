/**
 * The project folder a mission falls back to (`project-folder.ts`), as pure
 * rules: which project, which folder, and the project the config still scopes
 * its mission to once its folder came from that fallback. The launch itself is
 * covered by `project-folder-launch.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configProject, projectFolderFallback, useProjectFolder } from './project-folder.js';
import type { AgentConfig } from './agent-config.js';

const folders: Record<string, string | null> = {
  alpha: '/srv/projects/alpha-repo',
  beta: '/srv/projects/beta-repo',
  bare: null,
  blank: '   ',
};
const folderOf = (slug: string) => folders[slug];
const usable = () => true;

test('the task\'s project comes first, then the agent\'s', () => {
  assert.deepEqual(
    projectFolderFallback({ taskProject: 'alpha', agentProject: 'beta' }, folderOf, usable),
    { project: 'alpha', folder: '/srv/projects/alpha-repo' },
  );
  assert.deepEqual(
    projectFolderFallback({ taskProject: null, agentProject: 'beta' }, folderOf, usable),
    { project: 'beta', folder: '/srv/projects/beta-repo' },
  );
  assert.deepEqual(
    projectFolderFallback({ taskProject: '  ', agentProject: 'beta' }, folderOf, usable),
    { project: 'beta', folder: '/srv/projects/beta-repo' },
    'a blank task project is no project',
  );
});

test('no project, or a project without a folder, gives no folder', () => {
  assert.equal(projectFolderFallback({}, folderOf, usable), null);
  assert.equal(projectFolderFallback({ taskProject: 'unknown' }, folderOf, usable), null);
  assert.equal(projectFolderFallback({ taskProject: 'bare' }, folderOf, usable), null);
  assert.equal(projectFolderFallback({ agentProject: 'blank' }, folderOf, usable), null);
});

test('the task\'s project without a folder does not borrow the agent\'s project folder', () => {
  assert.equal(projectFolderFallback({ taskProject: 'bare', agentProject: 'beta' }, folderOf, usable), null);
});

test('a folder that cannot be used is not taken', () => {
  const seen: string[] = [];
  const gone = (path: string) => { seen.push(path); return false; };
  assert.equal(projectFolderFallback({ taskProject: 'alpha' }, folderOf, gone), null);
  assert.deepEqual(seen, ['/srv/projects/alpha-repo']);
});

test('a folder taken from the project moves the mission, not its project scope', () => {
  const cfg: AgentConfig = {};
  useProjectFolder(cfg, '/srv/projects/alpha-repo');
  assert.equal(cfg.cwd, '/srv/projects/alpha-repo');
  // `projectFromCwd` would read `alpha-repo` off the path: the scope stays what it was without a folder.
  assert.equal(configProject(cfg), null);
  // A provider that launches elsewhere is read as before.
  assert.equal(configProject(cfg, '/srv/projects/elsewhere'), 'elsewhere');
});

test('an agent\'s own folder and a declared project read as before', () => {
  assert.equal(configProject({ cwd: '/srv/projects/alpha-repo' }), 'alpha-repo');
  assert.equal(configProject({ project: 'beta', cwd: '/srv/projects/alpha-repo' }), 'beta');
  const declared: AgentConfig = { project: 'beta' };
  useProjectFolder(declared, '/srv/projects/alpha-repo');
  assert.equal(configProject(declared), 'beta');
  assert.equal(configProject({}), null);
});
