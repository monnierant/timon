/**
 * Runtime profiles in the core: the named homes a provider's program keeps on the host (a Hermes
 * profile), which one an agent runs on, and the model list that follows it. The list of a runtime
 * profile is kept apart from the backend's own, holds every model the agent announced (the ones
 * past the menu's cap marked for the search), and is what the guards judge a model against. An
 * agent without a runtime profile sees and is judged on the backend's list, as before.
 */
import '../test-home.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TIMON_RESOURCE_GUARD_ENABLED = '0';

const { registerDialect, registerProfile } = await import('./registry.js');
await import('../../tests/helpers/claude-provider.js');
const { echoDialect } = await import('../../tests/helpers/example-dialects.js');
const catalog = await import('./catalog.js');
const { agentConfigRefusal, RESTRICTED } = await import('../users/privileged-overrides.js');
type ProfileRuntime = import('./types.js').ProfileRuntime;

const OWNER = 'runtime-profiles-test';
const asked: string[] = [];
const announced: Record<string, Array<string | { slug: string; searchOnly?: boolean }>> = {
  '': ['shared-1', 'shared-2'],
  alpha: ['alpha-1', 'shared-1', { slug: 'alpha-far', searchOnly: true }],
  beta: ['beta-1'],
};
registerDialect(OWNER, 'acme-homes', {
  ...echoDialect,
  runtimeProfiles: {
    label: 'Acme profile',
    list: async () => ['alpha', 'beta'],
    env: (name: string) => ({ ACME_HOME: `/acme/profiles/${name}` }),
  },
  discoverModels: async (runtime: ProfileRuntime) => {
    asked.push(runtime.runtimeProfile ?? '');
    return announced[runtime.runtimeProfile ?? '']!;
  },
});
registerProfile(OWNER, { id: 'acme-homes', dialect: 'acme-homes', label: 'Acme', defaultModel: null, models: [], env: {} });
catalog.primeModelDiscovery();
const relaxed = { relaxed: true, ceiling: null };

test('the profiles a backend offers: its label and the host\'s names; a backend without any offers none', async () => {
  assert.deepEqual(await catalog.runtimeProfilesOf('acme-homes'), { label: 'Acme profile', names: ['alpha', 'beta'] });
  assert.equal(await catalog.runtimeProfilesOf('claude'), null);
  assert.equal(await catalog.runtimeProfilesOf('nobody'), null);
});

test('each runtime profile has its own list, the search-only models included; the backend keeps its own', async () => {
  await catalog.refreshRuntimeProfileModels('acme-homes', 'alpha');
  await catalog.refreshRuntimeProfileModels('acme-homes', 'beta');
  assert.ok(asked.includes('alpha') && asked.includes('beta'));
  const alpha = catalog.runtimeProfileCatalog('acme-homes', 'alpha');
  assert.deepEqual(alpha?.models.map((m) => [m.slug, m.searchOnly ?? false]), [['alpha-1', false], ['alpha-far', true], ['shared-1', false]]);
  assert.deepEqual(catalog.runtimeProfileCatalog('acme-homes', 'beta')?.models.map((m) => m.slug), ['beta-1']);
  assert.deepEqual(catalog.catalogBackend('acme-homes')?.models.map((m) => m.slug), ['shared-1', 'shared-2']);
  assert.equal(catalog.runtimeProfileCatalog('claude', 'alpha'), undefined, 'a backend without runtime profiles has no such list');
});

test('a name the host does not have is refused before any probe runs', async () => {
  const before = asked.length;
  await assert.rejects(catalog.refreshRuntimeProfileModels('acme-homes', 'gamma'), /Acme profile "gamma" is not one of acme-homes/);
  assert.equal(asked.length, before);
});

test('a model is judged against the agent\'s runtime profile, the one past the cap included', async () => {
  await catalog.refreshRuntimeProfileModels('acme-homes', 'alpha');
  assert.equal(catalog.catalogClaimsModel('acme-homes', 'alpha-far', 'alpha'), true);
  assert.equal(catalog.catalogClaimsModel('acme-homes', 'alpha-far'), false, 'not on the backend\'s own list');
  assert.equal(catalog.catalogClaimsModel('acme-homes', 'alpha-far', 'beta'), false, 'not on another profile\'s');
  assert.equal(catalog.catalogClaimsModel('acme-homes', 'shared-2'), true, 'no runtime profile: judged as before');
});

test('the agent guard: a model of the agent\'s profile passes, the field needs a backend that offers profiles and a clean name', async () => {
  await catalog.refreshRuntimeProfileModels('acme-homes', 'alpha');
  assert.equal(agentConfigRefusal({ backend: 'acme-homes', runtime_profile: 'alpha', model: 'alpha-far' }, null, relaxed), null);
  assert.match(agentConfigRefusal({ backend: 'acme-homes', model: 'alpha-far' }, null, relaxed) ?? '', /not in the catalogue/);
  assert.match(agentConfigRefusal({ backend: 'claude', runtime_profile: 'alpha' }, null, relaxed) ?? '', /runtime_profile: backend claude has no runtime profiles/);
  assert.match(agentConfigRefusal({ backend: 'acme-homes', runtime_profile: '../x' }, null, relaxed) ?? '', /runtime_profile must be/);
  assert.equal(agentConfigRefusal({ backend: 'acme-homes', runtime_profile: '' }, null, relaxed), null, 'empty = the default');
  const current = { backend: 'acme-homes', runtime_profile: 'alpha', model: 'alpha-far' };
  assert.equal(agentConfigRefusal({ runtime_profile: 'alpha', model: 'alpha-far' }, current, RESTRICTED), null, 'what the agent holds is never refused');
  assert.match(agentConfigRefusal({ runtime_profile: 'beta' }, current, RESTRICTED) ?? '', /runtime_profile.*agents:privileged-config/);
});
