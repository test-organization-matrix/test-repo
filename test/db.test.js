'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TodoStore } = require('../src/db');

function fresh() {
  return new TodoStore(':memory:');
}

test('creates and reads a todo with defaults', () => {
  const store = fresh();
  const todo = store.create({ title: 'Buy milk' });
  assert.equal(todo.title, 'Buy milk');
  assert.equal(todo.priority, 'medium');
  assert.equal(todo.done, false);
  assert.deepEqual(todo.tags, []);
  assert.equal(todo.dueDate, null);
  assert.ok(store.get(todo.id));
  store.close();
});

test('lists newest first by default and filters by done/priority/tag', () => {
  const store = fresh();
  store.create({ title: 'first' });
  store.create({ title: 'second', done: undefined });
  const third = store.create({ title: 'third', priority: 'high', tags: ['work'] });
  store.update(third.id, { done: true });

  const all = store.list();
  assert.equal(all.length, 3);
  assert.equal(all[0].title, 'third'); // newest first

  assert.equal(store.list({ done: false }).length, 2);
  assert.equal(store.list({ done: true }).length, 1);
  assert.equal(store.list({ priority: 'high' }).length, 1);
  assert.equal(store.list({ tag: 'work' }).length, 1);
  assert.equal(store.list({ tag: 'nope' }).length, 0);
  assert.equal(store.list({ q: 'seco' }).length, 1);
  store.close();
});

test('sorting by priority puts high first', () => {
  const store = fresh();
  store.create({ title: 'low', priority: 'low' });
  store.create({ title: 'high', priority: 'high' });
  store.create({ title: 'medium', priority: 'medium' });
  const sorted = store.list({ sort: 'priority' });
  assert.deepEqual(sorted.map((t) => t.priority), ['high', 'medium', 'low']);
  store.close();
});

test('update sets completedAt when marked done and clears it when reopened', () => {
  const store = fresh();
  const t = store.create({ title: 'x' });
  const done = store.update(t.id, { done: true });
  assert.equal(done.done, true);
  assert.ok(done.completedAt);
  const reopened = store.update(t.id, { done: false });
  assert.equal(reopened.done, false);
  assert.equal(reopened.completedAt, null);
  store.close();
});

test('update on a missing id returns null', () => {
  const store = fresh();
  assert.equal(store.update(999, { title: 'x' }), null);
  store.close();
});

test('remove and clearCompleted report what they deleted', () => {
  const store = fresh();
  const a = store.create({ title: 'a' });
  const b = store.create({ title: 'b' });
  store.update(a.id, { done: true });
  store.update(b.id, { done: true });
  assert.equal(store.remove(a.id), true);
  assert.equal(store.remove(a.id), false);
  assert.equal(store.clearCompleted(), 1);
  assert.equal(store.list().length, 0);
  store.close();
});

test('stats counts total, completed, open, high priority', () => {
  const store = fresh();
  const a = store.create({ title: 'a', priority: 'high' });
  store.create({ title: 'b' });
  store.update(a.id, { done: true });
  const s = store.stats();
  assert.equal(s.total, 2);
  assert.equal(s.completed, 1);
  assert.equal(s.open, 1);
  assert.equal(s.completionRate, 50);
  store.close();
});
