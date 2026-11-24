/**
 * The `timon` skill Timon may install in the home an agent's program runs on
 * (`runtime-profile-skill.ts`): written once, rewritten when Timon's version
 * changes, never over a copy a person edited or a skill of the same name Timon
 * did not write, and only when the operator turned the setting on. Every folder
 * is built here: the developer's own homes are never resolved.
 */
import './test-home.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeProfilesStrategy } from './backends/types.js';

const {
  RUNTIME_PROFILE_SKILL_SETTING, TIMON_SKILL_NAME, installTimonSkill, prepareRuntimeProfileSkill, timonSkillMarkdown,
} = await import('./runtime-profile-skill.js');
const { SETTINGS } = await import('./settings.js');
const { loadMcpCatalog } = await import('./remote-mcp/catalog.js');

const TOOL_NOTE = 'Witness note: tools are called `mcp__<server>__<tool>` in this program.';
const skillsHome = (): string => mkdtempSync(join(tmpdir(), 'timon-skills-home-'));
const skillMd = (dir: string): string => join(dir, TIMON_SKILL_NAME, 'SKILL.md');

test('the setting exists, is a boolean, and is off by default', () => {
  const def = SETTINGS.find((s) => s.key === RUNTIME_PROFILE_SKILL_SETTING);
  assert.ok(def, 'declared in settings.ts');
  assert.equal(def.type, 'bool');
  assert.equal(def.default, false);
});

test('first launch: the skill is written in <skills>/timon/SKILL.md, with the version and the program\'s note', () => {
  const dir = skillsHome();
  const result = installTimonSkill(dir, { version: '1.2.3', toolNames: TOOL_NOTE });
  assert.equal(result.outcome, 'written');
  const text = readFileSync(skillMd(dir), 'utf8');
  assert.match(text, /^---\nname: timon\n/);
  assert.match(text, /\nversion: 1\.2\.3\n/);
  assert.ok(text.includes(TOOL_NOTE));
});

test('same version: nothing is rewritten', () => {
  const dir = skillsHome();
  installTimonSkill(dir, { version: '1.2.3', toolNames: TOOL_NOTE });
  const before = statSync(skillMd(dir)).mtimeMs;
  const marker = readFileSync(join(dir, TIMON_SKILL_NAME, '.timon-skill.json'), 'utf8');
  const again = installTimonSkill(dir, { version: '1.2.3', toolNames: TOOL_NOTE });
  assert.equal(again.outcome, 'unchanged');
  assert.equal(statSync(skillMd(dir)).mtimeMs, before);
  assert.equal(readFileSync(join(dir, TIMON_SKILL_NAME, '.timon-skill.json'), 'utf8'), marker);
});

test('a new Timon version rewrites the copy Timon wrote', () => {
  const dir = skillsHome();
  installTimonSkill(dir, { version: '1.2.3', toolNames: TOOL_NOTE });
  const result = installTimonSkill(dir, { version: '1.3.0', toolNames: TOOL_NOTE });
  assert.equal(result.outcome, 'updated');
  assert.match(readFileSync(skillMd(dir), 'utf8'), /\nversion: 1\.3\.0\n/);
  assert.equal(installTimonSkill(dir, { version: '1.3.0', toolNames: TOOL_NOTE }).outcome, 'unchanged');
});

test('a copy a person edited is kept, even when Timon\'s version changes', () => {
  const dir = skillsHome();
  installTimonSkill(dir, { version: '1.2.3', toolNames: TOOL_NOTE });
  const edited = readFileSync(skillMd(dir), 'utf8') + '\nMy own note.\n';
  writeFileSync(skillMd(dir), edited);
  const result = installTimonSkill(dir, { version: '2.0.0', toolNames: TOOL_NOTE });
  assert.equal(result.outcome, 'kept-edited');
  assert.equal(readFileSync(skillMd(dir), 'utf8'), edited);
});

test('a `timon` skill Timon did not write is left alone', () => {
  const dir = skillsHome();
  mkdirSync(join(dir, TIMON_SKILL_NAME), { recursive: true });
  writeFileSync(skillMd(dir), '---\nname: timon\ndescription: mine\n---\n\nMine.\n');
  const result = installTimonSkill(dir, { version: '1.2.3', toolNames: TOOL_NOTE });
  assert.equal(result.outcome, 'kept-foreign');
  assert.equal(readFileSync(skillMd(dir), 'utf8'), '---\nname: timon\ndescription: mine\n---\n\nMine.\n');
  assert.equal(existsSync(join(dir, TIMON_SKILL_NAME, '.timon-skill.json')), false);
});

test('a folder that cannot be written is reported, never thrown', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const dir = skillsHome();
  chmodSync(dir, 0o500);
  try {
    const result = installTimonSkill(dir, { version: '1.2.3', toolNames: TOOL_NOTE });
    assert.equal(result.outcome, 'failed');
    assert.ok(result.error);
  } finally {
    chmodSync(dir, 0o700);
  }
});

const strategy = (dir: string | null, onDir?: (env: Readonly<Record<string, string | undefined>>) => void): RuntimeProfilesStrategy => ({
  label: 'Witness profile',
  list: async () => [],
  env: () => ({}),
  skills: { dir: (env) => { onDir?.(env); return dir; }, toolNames: TOOL_NOTE },
});

test('prepare: off by default, nothing is written', () => {
  const dir = skillsHome();
  assert.equal(prepareRuntimeProfileSkill(strategy(dir), {}, { enabled: () => false, version: () => '1.2.3' }), null);
  assert.equal(existsSync(join(dir, TIMON_SKILL_NAME)), false);
});

test('prepare: on, the folder comes from the launch environment the program gets', () => {
  const dir = skillsHome();
  const seen: Array<Readonly<Record<string, string | undefined>>> = [];
  const result = prepareRuntimeProfileSkill(strategy(dir, (env) => seen.push(env)), { WITNESS_HOME: '/x' }, { enabled: () => true, version: () => '1.2.3' });
  assert.equal(result?.outcome, 'written');
  assert.deepEqual(seen, [{ WITNESS_HOME: '/x' }]);
  assert.ok(existsSync(skillMd(dir)));
});

test('prepare: a program without skills, or with no folder to name, is left alone', () => {
  const bare: RuntimeProfilesStrategy = { label: 'Bare', list: async () => [], env: () => ({}) };
  assert.equal(prepareRuntimeProfileSkill(bare, {}, { enabled: () => true, version: () => '1.2.3' }), null);
  assert.equal(prepareRuntimeProfileSkill(undefined, {}, { enabled: () => true, version: () => '1.2.3' }), null);
  assert.equal(prepareRuntimeProfileSkill(strategy(null), {}, { enabled: () => true, version: () => '1.2.3' }), null);
});

test('prepare: a strategy that throws does not stop the launch', () => {
  const throwing: RuntimeProfilesStrategy = {
    label: 'Throws', list: async () => [], env: () => ({}),
    skills: { dir: () => { throw new Error('no home'); }, toolNames: TOOL_NOTE },
  };
  const result = prepareRuntimeProfileSkill(throwing, {}, { enabled: () => true, version: () => '1.2.3' });
  assert.equal(result?.outcome, 'failed');
});

test('the text: a skill the program accepts, Timon\'s real tool names, no full prefixed name written down', async () => {
  const text = timonSkillMarkdown({ version: '1.2.3', toolNames: TOOL_NOTE });
  const description = /\ndescription: "([^"]*)"\n/.exec(text)?.[1] ?? '';
  assert.ok(description.length > 20 && description.length <= 1024, 'a description within the 1024 characters skill loaders accept');
  for (const phrase of ['ignore previous instructions', 'ignore all previous', 'you are now', 'disregard your', 'forget your instructions', 'new instructions:', 'system prompt:', '<system>', ']]>']) {
    assert.equal(text.toLowerCase().includes(phrase), false, `"${phrase}" reads as a prompt injection to skill loaders`);
  }
  const timonPart = text.replace(TOOL_NOTE, '');
  assert.equal(/timon (task|status|agent|mission)\b/.test(timonPart), false, 'no CLI command for the agent: its terminal may hold another mission\'s credentials');
  assert.match(timonPart, /Not the `timon` CLI/);
  assert.equal(/mcp__\w+__\w+/.test(timonPart), false, 'Timon\'s part never spells a full prefixed tool name');
  const { TOOLS } = await loadMcpCatalog();
  const names = new Set(TOOLS.map((t) => t.name));
  const mentioned = [...timonPart.matchAll(/`((?:kanban|agent|mission|project_todo|docs)_[a-z_]+)`/g)].map((m) => m[1]!);
  assert.ok(mentioned.length >= 5, 'names the main short names');
  for (const name of mentioned) assert.ok(names.has(name), `\`${name}\` is not a tool of Timon's MCP server`);
});
