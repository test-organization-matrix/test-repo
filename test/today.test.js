'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TodoStore } = require('../src/db');
const { summarizeToday, buildTodayFallback } = require('../src/ai');

const TODAY = '2026-11-13';

function seededStore() {
  const store = new TodoStore(':memory:');
  store.create({ title: 'Due today open', dueDate: TODAY, priority: 'high' });
  store.create({ title: 'Overdue open', dueDate: '2026-11-01' });
  store.create({ title: 'Completed today', dueDate: TODAY });
  const done = store.list().find((t) => t.title === 'Completed today');
  store.update(done.id, { done: true });
  store.create({ title: 'Future open', dueDate: '2026-12-01' });
  store.create({ title: 'No date open' });
  return store;
}

test('todayOverview splits due / overdue / completed and counts them', () => {
  const store = seededStore();
  const o = store.todayOverview(TODAY);

  assert.equal(o.date, TODAY);
  assert.deepEqual(o.dueToday.map((t) => t.title), ['Due today open']);
  assert.deepEqual(o.overdue.map((t) => t.title), ['Overdue open']);
  assert.deepEqual(o.completedToday.map((t) => t.title), ['Completed today']);
  assert.deepEqual(o.counts, {
    dueToday: 1,
    overdue: 1,
    completedToday: 1,
    openTotal: 4,
    remainingToday: 2,
  });
  store.close();
});

test('todayOverview is empty on a quiet day', () => {
  const store = new TodoStore(':memory:');
  store.create({ title: 'Later', dueDate: '2026-12-25' });
  const o = store.todayOverview(TODAY);
  assert.equal(o.counts.dueToday, 0);
  assert.equal(o.counts.overdue, 0);
  assert.equal(o.counts.completedToday, 0);
  assert.equal(o.counts.remainingToday, 0);
  store.close();
});

test('buildTodayFallback prioritises overdue work', () => {
  const store = seededStore();
  const text = buildTodayFallback(store.todayOverview(TODAY));
  assert.match(text, /1 overdue/);
  assert.match(text, /overdue items first/i);
  store.close();
});

test('buildTodayFallback celebrates a clear slate', () => {
  const store = new TodoStore(':memory:');
  const text = buildTodayFallback(store.todayOverview(TODAY));
  assert.match(text, /clear slate/i);
  store.close();
});

test('summarizeToday uses the offline engine without a key', async () => {
  const store = seededStore();
  const res = await summarizeToday(store.todayOverview(TODAY), { ai: {} });
  assert.equal(res.engine, 'rules');
  assert.ok(res.summary.length > 0);
  store.close();
});

test('summarizeToday uses the LLM when configured', async () => {
  const store = seededStore();
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Three things left today.' } }] }),
  });
  const res = await summarizeToday(store.todayOverview(TODAY), {
    ai: { apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'm' },
    fetchImpl: fakeFetch,
  });
  assert.equal(res.engine, 'llm');
  assert.equal(res.summary, 'Three things left today.');
  store.close();
});

test('summarizeToday falls back to rules when the LLM errors', async () => {
  const store = seededStore();
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const res = await summarizeToday(store.todayOverview(TODAY), {
    ai: { apiKey: 'k', baseUrl: 'https://example.test/v1', model: 'm' },
    fetchImpl: fakeFetch,
  });
  assert.equal(res.engine, 'rules');
  assert.match(res.summary, /overdue items first/i);
  store.close();
});
