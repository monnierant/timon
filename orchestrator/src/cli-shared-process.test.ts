/**
 * TIM-3: a shell several missions share (an agent whose process outlives its
 * mission, `capabilities.processPerMission: false`) gets
 * `TIMON_SHARED_PROCESS=1` and no mission token. The `timon` CLI there must
 * refuse, never fall back to the daemon-token: that is the operator's
 * credential. Mock daemon on `127.0.0.1:0`, throwaway TIMON_HOME per test.
 */
import './test-home.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TIMON = fileURLToPath(new URL('../bin/timon', import.meta.url));

function operatorHome(port: number): string {
  const home = mkdtempSync(join(tmpdir(), 'timon-cli-shared-home-'));
  writeFileSync(join(home, 'daemon-token'), 'operator-token\n', { mode: 0o600 });
  writeFileSync(join(home, 'timon.config.json'), JSON.stringify({ daemon: { listen: { host: 'localhost', port } } }));
  return home;
}

function env(home: string, url: string, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = { ...process.env, TIMON_HOME: home, TIMON_API: url, TIMON_RESOURCE_GUARD_ENABLED: '0' };
  // Node warns on stderr when both are set, and the checks read stderr.
  delete base.FORCE_COLOR;
  delete base.NO_COLOR;
  for (const key of ['TIMON_API_TOKEN', 'TIMON_MISSION_ID', 'TIMON_SHARED_PROCESS', 'TIMON_ORCH_URL']) delete base[key];
  return { ...base, ...extra };
}

function runTimon(args: string[], childEnv: NodeJS.ProcessEnv): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TIMON, ...args], { env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer | string) => { stderr += String(c); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

async function withDaemon(run: (url: string, port: number, auths: (string | undefined)[]) => Promise<void>): Promise<void> {
  const auths: (string | undefined)[] = [];
  const server = http.createServer((req, res) => {
    auths.push(req.headers.authorization);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tasks: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`, address.port, auths);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('a shared shell refuses to act rather than fall back to the daemon-token', async () => {
  await withDaemon(async (url, port, auths) => {
    const r = await runTimon(['task', 'list'], env(operatorHome(port), url, { TIMON_SHARED_PROCESS: '1' }));
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /shared by every mission/);
    assert.match(r.stderr, /MCP tools/);
    assert.deepEqual(auths, [], 'no request left with the operator\'s credential');
  });
});

test('witness: the same shell without the flag still uses the daemon-token', async () => {
  await withDaemon(async (url, port, auths) => {
    const r = await runTimon(['task', 'list'], env(operatorHome(port), url, {}));
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(auths, ['Bearer operator-token']);
  });
});
