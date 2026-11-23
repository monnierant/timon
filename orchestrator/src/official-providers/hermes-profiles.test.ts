/**
 * The Hermes profiles an agent may run on (`official-providers/provider-acp/lib/hermes-profiles.js`):
 * which homes count as profiles, the root they are read under, the environment that selects one,
 * and the row of the Hermes agent that carries the strategy. Read on a folder built here, never
 * on the developer's own `~/.hermes`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { hermesProfiles, hermesRoot } = await import('../../official-providers/provider-acp/lib/hermes-profiles.js');
const { ACP_AGENTS } = await import('../../official-providers/provider-acp/lib/agents.js');

/** A Hermes root with `profiles/<name>` homes; each entry says which marker file it holds (none = an empty folder). */
function hermesHome(homes: Record<string, string | null>, extra?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'timon-hermes-root-'));
  writeFileSync(join(root, 'config.yaml'), 'model: {}\n');
  for (const [name, marker] of Object.entries(homes)) {
    mkdirSync(join(root, 'profiles', name), { recursive: true });
    if (marker) writeFileSync(join(root, 'profiles', name, marker), '');
  }
  extra?.(root);
  return root;
}

const runtime = (env: Record<string, string>) => ({ id: 'hermes', cmd: 'hermes-acp', env }) as never;

test('list: the named homes Hermes itself lists, sorted, never the default nor a folder that is not a profile', async () => {
  const root = hermesHome({
    beta: 'SOUL.md', alpha: 'config.yaml', 'with-env': '.env', default: 'config.yaml',
    'Upper': 'config.yaml', '-dash': 'config.yaml', empty: null, gone: 'config.yaml',
  }, (r) => mkdirSync(join(r, 'profiles', '.deleted', 'gone'), { recursive: true }));
  const homes = hermesProfiles({ platform: 'linux', homedir: () => '/nowhere' });
  assert.equal(homes.label, 'Hermes profile');
  assert.deepEqual(await homes.list(runtime({ HERMES_HOME: root })), ['alpha', 'beta', 'with-env']);
});

test('list: a host without profiles answers an empty list, not an error', async () => {
  const homes = hermesProfiles({ platform: 'linux', homedir: () => '/nowhere' });
  assert.deepEqual(await homes.list(runtime({ HERMES_HOME: mkdtempSync(join(tmpdir(), 'timon-hermes-bare-')) })), []);
});

test('the root: HERMES_HOME as forwarded, the root above it when it already names a profile, the platform default otherwise', () => {
  const linux = { platform: 'linux' as const, homedir: () => '/home/ann' };
  assert.equal(hermesRoot({}, linux), join('/home/ann', '.hermes'));
  assert.equal(hermesRoot({ HERMES_HOME: '/srv/hermes' }, linux), '/srv/hermes');
  assert.equal(hermesRoot({ HERMES_HOME: '/srv/hermes/profiles/coder' }, linux), '/srv/hermes');
  assert.equal(hermesRoot({ HERMES_HOME: join('/home/ann', '.hermes', 'profiles', 'coder') }, linux), join('/home/ann', '.hermes'));
  assert.equal(hermesRoot({ HERMES_HOME: '~/hermes-data' }, linux), join('/home/ann', 'hermes-data'));
  assert.equal(hermesRoot({}, { platform: 'win32', homedir: () => 'C:\\Users\\ann', localAppData: 'D:\\Local' }), join('D:\\Local', 'hermes'));
});

test('env: HERMES_HOME on the profile\'s home; a name the host does not have is refused with a sentence', () => {
  const root = hermesHome({ alpha: 'config.yaml' });
  const homes = hermesProfiles({ platform: 'linux', homedir: () => '/nowhere' });
  assert.deepEqual(homes.env('alpha', runtime({ HERMES_HOME: root })), { HERMES_HOME: join(root, 'profiles', 'alpha') });
  assert.throws(() => homes.env('beta', runtime({ HERMES_HOME: root })), /Hermes profile "beta" does not exist under .*hermes profile list/);
  assert.throws(() => homes.env('../alpha', runtime({ HERMES_HOME: root })), /not a Hermes profile name/);
  assert.throws(() => homes.env('default', runtime({ HERMES_HOME: root })), /leave the field empty/);
});

test('the Hermes row carries the strategy; the other ACP agents have none', () => {
  const hermes = ACP_AGENTS.find((agent) => agent.id === 'hermes');
  assert.equal(hermes?.runtimeProfiles?.label, 'Hermes profile');
  for (const agent of ACP_AGENTS.filter((a) => a.id !== 'hermes')) assert.equal(agent.runtimeProfiles, undefined, agent.id);
});
