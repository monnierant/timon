/**
 * The HTTP side of runtime profiles: the names a backend offers, the catalogue read for an
 * agent (or for a draft profile) carrying that profile's list, and `runtime_profile` on the
 * agent's config, checked against the names the host has. Isolated TIMON_HOME, witness on
 * 127.0.0.1:0, a made-up provider whose probe answers per profile.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.TIMON_HOME = mkdtempSync(join(tmpdir(), 'timon-runtime-profiles-'));
process.env.TIMON_RESOURCE_GUARD_ENABLED = '0';
await import('../../../tests/helpers/claude-provider.js');

const { registerDialect, registerProfile } = await import('../../backends/registry.js');
const { echoDialect } = await import('../../../tests/helpers/example-dialects.js');
const { primeModelDiscovery } = await import('../../backends/catalog.js');
const { createDaemonAuthMiddleware } = await import('../http/auth.js');
const { registerRoutes: registerBackendRoutes } = await import('./routes.js');
const { registerRoutes: registerAgentRoutes } = await import('../agents/routes.js');
const { agentDir } = await import('../../paths.js');
type ProfileRuntime = import('../../backends/types.js').ProfileRuntime;

const many = Array.from({ length: 75 }, (_, i) => `alpha-model-${String(i).padStart(2, '0')}`);
registerDialect('runtime-profile-routes', 'acme-homes', {
  ...echoDialect,
  runtimeProfiles: { label: 'Acme profile', list: async () => ['alpha', 'beta'], env: (name: string) => ({ ACME_HOME: name }) },
  discoverModels: async (runtime: ProfileRuntime) => {
    if (runtime.runtimeProfile === 'alpha') {
      return many.map((slug, i) => ({ slug, ...(i >= 60 && slug !== 'alpha-model-70' ? { searchOnly: true } : {}), ...(slug === 'alpha-model-70' ? { current: true } : {}) }));
    }
    if (runtime.runtimeProfile === 'beta') return ['beta-model-00', 'beta-model-01'];
    return ['root-model-00'];
  },
});
registerProfile('runtime-profile-routes', { id: 'acme-homes', dialect: 'acme-homes', label: 'Acme', defaultModel: null, models: [], env: {} });
primeModelDiscovery();

const TOKEN = 'witness-daemon-token';
const app = express();
app.use(createDaemonAuthMiddleware({ token: TOKEN, required: true }));
app.use(express.json());
registerBackendRoutes(app);
registerAgentRoutes(app);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
test.after(() => { server.close(); });

function agent(name: string, config: Record<string, unknown>): void {
  mkdirSync(agentDir(name), { recursive: true });
  writeFileSync(join(agentDir(name), 'config.json'), JSON.stringify({ cwd: process.env.TIMON_HOME, ...config }));
}
const stored = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(agentDir(name), 'config.json'), 'utf8')) as Record<string, unknown>;
const get = (path: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
const patch = (name: string, body: unknown) => fetch(`${base}/api/agents/${name}/config`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body),
});
type Catalog = { backends: Array<{ id: string; defaultModel: string | null; runtimeProfile?: string; models: Array<{ slug: string; searchOnly?: boolean }> }> };
async function acmeOf(query: string) {
  const res = await get(`/api/backends/catalog${query}`);
  assert.equal(res.status, 200);
  return ((await res.json()) as Catalog).backends.find((b) => b.id === 'acme-homes')!;
}

agent('on-alpha', { backend: 'acme-homes', runtime_profile: 'alpha' });
agent('on-beta', { backend: 'acme-homes', runtime_profile: 'beta' });
agent('on-default', { backend: 'acme-homes' });

test('the names a backend offers, with what the field is called; none for a backend without', async () => {
  const res = await get('/api/backends/acme-homes/runtime-profiles');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { label: 'Acme profile', names: ['alpha', 'beta'] });
  assert.equal((await get('/api/backends/claude/runtime-profiles')).status, 404);
});

test('read for an agent, the catalogue carries its profile\'s list: two agents, two lists', async () => {
  const alpha = await acmeOf('?agent=on-alpha');
  assert.equal(alpha.runtimeProfile, 'alpha');
  assert.equal(alpha.models.length, 75, 'the whole list, the ones past the cap included');
  assert.equal(alpha.models.filter((m) => !m.searchOnly).length, 61);
  assert.equal(alpha.defaultModel, 'alpha-model-70', 'the model the agent runs when none is named');
  const beta = await acmeOf('?agent=on-beta');
  assert.deepEqual(beta.models.map((m) => m.slug), ['beta-model-00', 'beta-model-01']);
});

test('an agent without a profile, and the catalogue read for nobody, are as before', async () => {
  assert.deepEqual((await acmeOf('?agent=on-default')).models.map((m) => m.slug), ['root-model-00']);
  const plain = await acmeOf('');
  assert.deepEqual(plain.models.map((m) => m.slug), ['root-model-00']);
  assert.equal(plain.runtimeProfile, undefined);
});

test('the editor\'s draft profile wins over the saved one; empty reads the default', async () => {
  assert.deepEqual((await acmeOf('?agent=on-alpha&runtimeProfile=beta')).models.map((m) => m.slug), ['beta-model-00', 'beta-model-01']);
  assert.deepEqual((await acmeOf('?agent=on-alpha&runtimeProfile=')).models.map((m) => m.slug), ['root-model-00']);
  assert.deepEqual((await acmeOf('?runtimeProfile=beta&runtimeProfileBackend=acme-homes')).models.map((m) => m.slug), ['beta-model-00', 'beta-model-01']);
  assert.deepEqual((await acmeOf('?runtimeProfile=beta&runtimeProfileBackend=claude')).models.map((m) => m.slug), ['root-model-00'], 'a draft for another backend');
});

test('the config takes a profile the host has, refuses one it has not, and empty clears it', async () => {
  agent('editable', { backend: 'acme-homes' });
  let res = await patch('editable', { runtime_profile: 'alpha', model: 'alpha-model-74' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(stored('editable').runtime_profile, 'alpha');
  assert.equal(stored('editable').model, 'alpha-model-74', 'a model past the 60th is saved');
  res = await patch('editable', { runtime_profile: 'gamma' });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /Acme profile "gamma" is not one of acme-homes/);
  assert.equal(stored('editable').runtime_profile, 'alpha');
  res = await patch('editable', { runtime_profile: '' });
  assert.equal(res.status, 200);
  assert.equal('runtime_profile' in stored('editable'), false);
  agent('plain', { backend: 'claude' });
  res = await patch('plain', { runtime_profile: 'alpha' });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /has no runtime profiles/);
});

const upsert = (name: string, config: Record<string, unknown>) => fetch(`${base}/api/agents`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ name, system_prompt: 'You test.', config: { cwd: process.env.TIMON_HOME, ...config } }),
});

test('the editor\'s save: a profile the host has is kept, an unknown one refused, a save without the field keeps it, null clears it', async () => {
  let res = await upsert('saved', { backend: 'acme-homes', runtime_profile: 'beta', model: 'beta-model-01' });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(stored('saved').runtime_profile, 'beta');
  res = await upsert('saved', { backend: 'acme-homes', runtime_profile: 'nope' });
  assert.equal(res.status, 400);
  assert.equal(stored('saved').runtime_profile, 'beta');
  res = await upsert('saved', { backend: 'acme-homes', model: 'beta-model-00' });
  assert.equal(res.status, 200);
  assert.equal(stored('saved').runtime_profile, 'beta', 'a writer that does not know the field does not erase it');
  res = await upsert('saved', { backend: 'acme-homes', runtime_profile: null });
  assert.equal(res.status, 200);
  assert.equal('runtime_profile' in stored('saved'), false);
});
