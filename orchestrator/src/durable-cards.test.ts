/**
 * Durable cards (ADR 0002): a card closes on its answer or with its mission,
 * never on a timer. Past the live wait the agent is told to end its turn, the
 * card stays open — in memory and in `pending_cards`, so a restart keeps it —
 * and its answer, Allow or Deny, resumes the mission.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeHomeOnExit } from '../tests/helpers/test-home.js';

const TMP_HOME = mkdtempSync(join(tmpdir(), 'timon-durable-cards-test-'));
process.env.TIMON_HOME = TMP_HOME;
process.env.TIMON_PERMISSION_LIVE_WAIT_MS = '60';
removeHomeOnExit(TMP_HOME);
// The live-wait timer is unref'd (a daemon's server keeps its loop alive): here
// something must, or the test would end before a card is set aside.
const keepAlive = setInterval(() => { /* */ }, 1_000);
after(() => clearInterval(keepAlive));

const {
  requestPermission, resolvePermission, listPending, restorePendingCards, missionWaitsForAnswer,
  expirePendingForMission, answerMessage, parkedCardMessage, startPermissionExpiry,
} = await import('./permissions.js');
const { dbApi } = await import('./db.js');
const { bus } = await import('./bus.js');

const questions = { questions: [{ question: 'Which?', header: 'h', options: [{ label: 'a' }, { label: 'b' }] }] };

/** An autonomous mission: spawned by an agent, with a pilot. */
function autonomousMission(id: string): void {
  dbApi.createMission(`${id}-boss`, 'acme.main', 'pilot', { channel: 'chat' });
  dbApi.createMission(id, 'acme.coder', 'code it', { channel: 'agent' });
  dbApi.setMissionLineage(id, { parentMissionId: `${id}-boss`, parentAgent: 'acme.main' });
}

test('an autonomous mission may ask a question: the card opens and is stored', async () => {
  autonomousMission('m-ask');
  const decision = requestPermission({
    mission_id: 'm-ask', agent: 'acme.coder', tool_name: 'ask_user', input: questions, tool_use_id: 'tu-ask',
  });
  const [card] = listPending('m-ask');
  assert.ok(card, 'the question opened a card');
  assert.equal(card.timeout_ms, 0, 'a durable card has no expiry');
  const stored = dbApi.listPendingCards().find((c) => c.id === card.id);
  assert.ok(stored, 'the card is in the store');
  assert.equal(stored.parked_at, null);
  assert.equal(missionWaitsForAnswer('m-ask'), true);

  // Past the live wait: the call is told to end its turn, the card stays open.
  const answer = await decision;
  assert.equal(answer.behavior, 'deny');
  assert.equal(answer.behavior === 'deny' ? answer.message : '', parkedCardMessage(card));
  assert.equal(listPending('m-ask').length, 1, 'still open after the live wait');
  assert.ok(dbApi.listPendingCards().find((c) => c.id === card.id)?.parked_at, 'marked as set aside');
  assert.equal(dbApi.missionHasParkedCard('m-ask'), true);

  // The same call posted again gets the same hand-off, not a second card.
  const again = await requestPermission({
    mission_id: 'm-ask', agent: 'acme.coder', tool_name: 'ask_user', input: questions, tool_use_id: 'tu-ask',
  });
  assert.equal(again.behavior, 'deny');
  assert.equal(listPending('m-ask').length, 1);

  // The answer closes it, in memory and in the store.
  assert.equal(resolvePermission(card.id, { behavior: 'allow', updatedInput: { answers: { 'Which?': 'a' } } }), true);
  assert.equal(listPending('m-ask').length, 0);
  assert.equal(dbApi.listPendingCards().some((c) => c.id === card.id), false);
  assert.equal(missionWaitsForAnswer('m-ask'), false);
});

test('a waiting task leaves the work in progress, and the board says it waits', async () => {
  autonomousMission('m-task');
  dbApi.createTask('t-wait', 'Wait for me', 'acme.coder');
  dbApi.updateTaskStatus('t-wait', 'IN_PROGRESS');
  dbApi.assignTaskMission('t-wait', 'm-task');
  const before = dbApi.countInProgress();
  const decision = requestPermission({
    mission_id: 'm-task', agent: 'acme.coder', tool_name: 'Bash', input: { command: 'make deploy' }, tool_use_id: 'tu-task',
  });
  await decision;
  assert.deepEqual([...dbApi.missionsWaitingForAnswer()].includes('m-task'), true);
  assert.equal(dbApi.countInProgress(), before - 1, 'a task waiting for an answer runs nothing');
  expirePendingForMission('m-task');
  assert.equal(dbApi.countInProgress(), before);
  assert.equal(dbApi.listPendingCards().some((c) => c.mission_id === 'm-task'), false, 'ending the mission ends its cards');
});

test('an Allow on a set-aside approval lets the same call through, once', async () => {
  autonomousMission('m-allow');
  const input = { command: 'rm -rf build' };
  const first = await requestPermission({
    mission_id: 'm-allow', agent: 'acme.coder', tool_name: 'Bash', input, tool_use_id: 'tu-allow-1',
  });
  assert.equal(first.behavior, 'deny', 'set aside after the live wait');
  const [card] = listPending('m-allow');
  assert.ok(card);
  assert.equal(resolvePermission(card.id, { behavior: 'allow' }), true);

  // The resumed agent calls it again: it passes without a card.
  const retry = await requestPermission({
    mission_id: 'm-allow', agent: 'acme.coder', tool_name: 'Bash', input, tool_use_id: 'tu-allow-2',
  });
  assert.equal(retry.behavior, 'allow');
  assert.equal(listPending('m-allow').length, 0);

  // Another input is not covered, and the grant is spent.
  const other = requestPermission({
    mission_id: 'm-allow', agent: 'acme.coder', tool_name: 'Bash', input: { command: 'rm -rf /' }, tool_use_id: 'tu-allow-3',
  });
  assert.equal(listPending('m-allow').length, 1, 'another input opens a card');
  expirePendingForMission('m-allow');
  assert.equal((await other).behavior, 'deny');
  const third = requestPermission({
    mission_id: 'm-allow', agent: 'acme.coder', tool_name: 'Bash', input, tool_use_id: 'tu-allow-4',
  });
  assert.equal(listPending('m-allow').length, 1, 'the grant served once');
  expirePendingForMission('m-allow');
  await third;
});

test('a Deny on a set-aside approval grants nothing', async () => {
  autonomousMission('m-deny');
  const input = { command: 'curl evil' };
  await requestPermission({ mission_id: 'm-deny', agent: 'acme.coder', tool_name: 'Bash', input, tool_use_id: 'tu-deny-1' });
  const [card] = listPending('m-deny');
  assert.ok(card);
  assert.equal(resolvePermission(card.id, { behavior: 'deny', message: 'no network' }), true);
  const retry = requestPermission({ mission_id: 'm-deny', agent: 'acme.coder', tool_name: 'Bash', input, tool_use_id: 'tu-deny-2' });
  assert.equal(listPending('m-deny').length, 1, 'a new card, not a pass');
  expirePendingForMission('m-deny');
  await retry;
});

test('the answer message says what was asked and what the user decided', () => {
  const base = {
    id: 'c', mission_id: 'm', agent: 'a', tool_use_id: 't', created_at: 0, timeout_ms: 0,
  } as const;
  const allowed = answerMessage({ ...base, tool_name: 'Bash', input: {} }, { behavior: 'allow' });
  assert.match(allowed, /allowed `Bash`/);
  assert.match(allowed, /same input/);
  const denied = answerMessage({ ...base, tool_name: 'Bash', input: {} }, { behavior: 'deny', message: 'not now' });
  assert.match(denied, /did not allow `Bash`/);
  assert.match(denied, /not now/);
  const answered = answerMessage({ ...base, tool_name: 'ask_user', input: questions }, {
    behavior: 'allow', updatedInput: { answers: { 'Which?': 'b' } },
  });
  assert.match(answered, /b/);
});

test('a card the store kept comes back after a restart, set aside', () => {
  // What a previous process left: a card still waited on live when it died.
  dbApi.createMission('m-restart', 'acme.coder', 'code it', { channel: 'chat' });
  dbApi.insertPendingCard({
    id: 'card-restart', mission_id: 'm-restart', agent: 'acme.coder', tool_name: 'ask_user', tool_use_id: 'tu-r',
    card: { id: 'card-restart', mission_id: 'm-restart', agent: 'acme.coder', tool_name: 'ask_user', tool_use_id: 'tu-r', input: questions, created_at: 1, timeout_ms: 0 },
    input_key: 'k', created_at: 1, parked_at: null,
  });
  // And one whose mission is gone.
  dbApi.insertPendingCard({
    id: 'card-orphan', mission_id: 'm-gone', agent: 'acme.coder', tool_name: 'Bash', tool_use_id: 'tu-o',
    card: { input: {} }, input_key: 'k', created_at: 1, parked_at: null,
  });
  assert.equal(restorePendingCards(), 1);
  const [card] = listPending('m-restart');
  assert.ok(card, 'the card is open again');
  assert.equal(card.tool_name, 'ask_user');
  assert.ok(dbApi.listPendingCards().find((c) => c.id === 'card-restart')?.parked_at, 'set aside: nobody waits on it');
  assert.equal(dbApi.listPendingCards().some((c) => c.id === 'card-orphan'), false, 'a card without mission is dropped');
  assert.equal(missionWaitsForAnswer('m-restart'), true);
  assert.equal(restorePendingCards(), 0, 'restoring twice changes nothing');
  expirePendingForMission('m-restart');
});

test('a mission process that exits sets its open cards aside instead of expiring them', async () => {
  const stop = startPermissionExpiry();
  try {
    dbApi.createMission('m-exit', 'acme.coder', 'chat', { channel: 'chat' });
    process.env.TIMON_PERMISSION_LIVE_WAIT_MS = '600000';
    const pending = requestPermission({
      mission_id: 'm-exit', agent: 'acme.coder', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu-exit',
    });
    process.env.TIMON_PERMISSION_LIVE_WAIT_MS = '60';
    bus.publish({ kind: 'mission_complete', missionId: 'm-exit', status: 'completed', exitCode: 0 });
    const decision = await pending;
    assert.equal(decision.behavior, 'deny');
    assert.equal(listPending('m-exit').length, 1, 'the card outlives the process');
    assert.equal(dbApi.missionHasParkedCard('m-exit'), true);
  } finally {
    expirePendingForMission('m-exit');
    stop();
  }
});
