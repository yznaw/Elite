import test from 'node:test';
import assert from 'node:assert/strict';
import { CountAutosave, parseCount } from '../projects/admin-portal/src/app/utils/stocktake-autosave.ts';

/** A save function whose calls can be resolved or failed one by one. */
function controllableSave() {
  const calls: { variantId: string; quantity: number; resolve: () => void; reject: (e: Error) => void }[] = [];
  const save = (variantId: string, quantity: number) => new Promise<void>((resolve, reject) => {
    calls.push({ variantId, quantity, resolve, reject });
  });
  return { calls, save };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function autosave(save: (id: string, q: number) => Promise<void>) {
  const timers: (() => void)[] = [];
  let changes = 0;
  const box = new CountAutosave({ save, onChange: () => { changes++; }, setTimer: (run) => { timers.push(run); } });
  return { box, timers, changes: () => changes };
}

test('parseCount accepts whole non-negative numbers only', () => {
  assert.equal(parseCount('0'), 0);
  assert.equal(parseCount(' 12 '), 12);
  for (const bad of ['', ' ', '-1', '1.5', '1e3', 'abc', '5pcs', '99999999999999999999', null, undefined]) {
    assert.equal(parseCount(bad as string), null, `rejects ${bad}`);
  }
});

test('typing marks a row unsaved without sending anything', () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '4');
  assert.equal(box.state('v1'), 'unsaved');
  assert.equal(box.pendingCount(), 1);
  assert.equal(calls.length, 0);
});

test('committing saves once, clears the box and shows Saved, then settles', async () => {
  const { calls, save } = controllableSave();
  const { box, timers } = autosave(save);
  box.setDraft('v1', '4');
  const result = box.commit('v1');
  assert.equal(box.state('v1'), 'saving');
  assert.deepEqual(calls.map((c) => [c.variantId, c.quantity]), [['v1', 4]]);
  calls[0].resolve();
  assert.equal(await result, 'saved');
  assert.equal(box.state('v1'), 'saved');
  assert.equal(box.draft('v1'), undefined);
  assert.equal(box.pendingCount(), 0);
  timers.forEach((run) => run());
  assert.equal(box.state('v1'), undefined, 'Saved fades back to the plain count');
});

test('zero is a real count and is saved', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '0');
  const result = box.commit('v1');
  calls[0].resolve();
  assert.equal(await result, 'saved');
  assert.equal(calls[0].quantity, 0);
});

test('an empty box commits nothing', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  assert.equal(await box.commit('v1'), 'empty');
  box.setDraft('v1', '   ');
  assert.equal(await box.commit('v1'), 'empty');
  assert.equal(box.state('v1'), undefined);
  assert.equal(calls.length, 0);
});

test('invalid values are flagged, kept and never sent', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  for (const bad of ['-2', '1.5', 'abc']) {
    box.setDraft('v1', bad);
    assert.equal(await box.commit('v1'), 'invalid');
    assert.equal(box.state('v1'), 'invalid');
    assert.equal(box.draft('v1'), bad);
  }
  assert.equal(calls.length, 0);
  assert.equal(box.pendingCount(), 1, 'an invalid row still counts as unsaved');
});

test('a failed save keeps the value, shows error, and a retry succeeds', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '7');
  const first = box.commit('v1');
  calls[0].reject(new Error('offline'));
  assert.equal(await first, 'error');
  assert.equal(box.state('v1'), 'error');
  assert.equal(box.draft('v1'), '7');
  assert.equal(box.pendingCount(), 1);

  const retry = box.commit('v1');
  calls[1].resolve();
  assert.equal(await retry, 'saved');
  assert.equal(box.pendingCount(), 0);
});

test('a value committed during a save is sent after it: last value wins, in order', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '3');
  const first = box.commit('v1');
  box.setDraft('v1', '5');
  assert.equal(await box.commit('v1'), 'queued');
  assert.equal(box.state('v1'), 'saving', 'still saving, not flipped to unsaved');
  box.setDraft('v1', '6');
  assert.equal(await box.commit('v1'), 'queued');
  calls[0].resolve();
  await tick();
  assert.deepEqual(calls.map((c) => c.quantity), [3, 6], 'the superseded 5 is never sent');
  calls[1].resolve();
  assert.equal(await first, 'saved');
  assert.equal(box.draft('v1'), undefined);
  assert.equal(box.pendingCount(), 0);
});

test('committing the same value twice (Enter then blur) sends one request', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '2');
  const first = box.commit('v1');
  assert.equal(await box.commit('v1'), 'queued');
  calls[0].resolve();
  await first;
  assert.equal(await box.commit('v1'), 'empty');
  assert.equal(calls.length, 1);
});

test('a value typed but not committed during a save stays unsaved afterwards', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '3');
  const first = box.commit('v1');
  box.setDraft('v1', '9');
  calls[0].resolve();
  await first;
  assert.equal(box.draft('v1'), '9');
  assert.equal(box.state('v1'), 'unsaved');
  assert.equal(box.pendingCount(), 1);
});

test('saveAll saves every typed row and reports failures and invalid rows', async () => {
  const fails = new Set(['v2']);
  const sent: string[] = [];
  const { box } = autosave(async (id) => { sent.push(id); if (fails.has(id)) throw new Error('500'); });
  box.setDraft('v1', '1');
  box.setDraft('v2', '2');
  box.setDraft('v3', 'x');
  box.setDraft('v4', '0');
  const summary = await box.saveAll();
  assert.deepEqual(summary, { saved: 2, failed: 1, invalid: 1 });
  assert.deepEqual(sent, ['v1', 'v2', 'v4']);
  assert.equal(box.pendingCount(), 2, 'the failed and the invalid row are still pending');
});

test('saveAll also waits for a save already in flight', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '1');
  void box.commit('v1');
  const all = box.saveAll();
  await tick();
  calls.forEach((c) => c.resolve());
  await tick();
  calls.forEach((c) => c.resolve());
  await all;
  assert.equal(box.pendingCount(), 0);
});

test('rows are independent: one failing row does not block another', async () => {
  const { calls, save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('a', '1');
  box.setDraft('b', '2');
  const a = box.commit('a');
  const b = box.commit('b');
  assert.equal(calls.length, 2, 'different rows save in parallel');
  calls[0].reject(new Error('x'));
  calls[1].resolve();
  assert.equal(await a, 'error');
  assert.equal(await b, 'saved');
});

test('clearing a typed box removes its unsaved state', () => {
  const { save } = controllableSave();
  const { box } = autosave(save);
  box.setDraft('v1', '3');
  box.setDraft('v1', '');
  assert.equal(box.state('v1'), undefined);
  assert.equal(box.pendingCount(), 0);
});

test('reset forgets every draft (after switching location)', () => {
  const { save } = controllableSave();
  const { box, changes } = autosave(save);
  box.setDraft('v1', '3');
  box.setDraft('v2', 'x');
  const before = changes();
  box.reset();
  assert.equal(box.pendingCount(), 0);
  assert.equal(box.draft('v1'), undefined);
  assert.ok(changes() > before, 'the UI is told to refresh');
});
