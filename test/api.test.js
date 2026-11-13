'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { TodoStore } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;
let store;

before(async () => {
  store = new TodoStore(':memory:');
  const app = createApp({ store, ai: {} });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  store.close();
});

const json = (res) => res.json();

test('health reports AI disabled without a key', async () => {
  const body = await json(await fetch(`${base}/api/health`));
  assert.equal(body.ok, true);
  assert.equal(body.aiEnabled, false);
});

test('full CRUD lifecycle over HTTP', async () => {
  const created = await fetch(`${base}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Write tests', priority: 'high', tags: ['dev'] }),
  });
  assert.equal(created.status, 201);
  const todo = await created.json();
  assert.equal(todo.title, 'Write tests');
  assert.equal(todo.priority, 'high');

  const patched = await fetch(`${base}/api/todos/${todo.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done: true }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).done, true);

  const list = await json(await fetch(`${base}/api/todos`));
  assert.equal(list.todos.length, 1);
  assert.equal(list.stats.completed, 1);

  const del = await fetch(`${base}/api/todos/${todo.id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);

  const missing = await fetch(`${base}/api/todos/${todo.id}`);
  assert.equal(missing.status, 404);
});

test('rejects invalid payloads with 400', async () => {
  const cases = [
    {},
    { title: '' },
    { title: 'x', priority: 'asap' },
    { title: 'x', dueDate: '13-11-2026' },
    { title: 'x', tags: 'work' },
    { title: 'x', done: 'yes' },
    { title: 'x'.repeat(201) },
  ];
  for (const body of cases) {
    const res = await fetch(`${base}/api/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
  }
});

test('malformed JSON is a 400, not a crash', async () => {
  const res = await fetch(`${base}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not json',
  });
  assert.equal(res.status, 400);
});

test('AI parse returns a draft and does not save it', async () => {
  const before = (await json(await fetch(`${base}/api/todos`))).todos.length;
  const res = await fetch(`${base}/api/ai/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Ship the release tomorrow #work urgent' }),
  });
  assert.equal(res.status, 200);
  const draft = await res.json();
  assert.equal(draft.priority, 'high');
  assert.deepEqual(draft.tags, ['work']);
  assert.equal(draft.dueDate !== null, true);
  const after = (await json(await fetch(`${base}/api/todos`))).todos.length;
  assert.equal(after, before, 'parse must not persist anything');
});

test('AI add parses and saves in one call', async () => {
  const res = await fetch(`${base}/api/ai/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Call the dentist tomorrow' }),
  });
  assert.equal(res.status, 201);
  const { todo, engine } = await res.json();
  assert.equal(engine, 'rules');
  assert.ok(todo.id);
});

test('AI endpoints reject empty or oversized text', async () => {
  for (const body of [{}, { text: '' }, { text: 'x'.repeat(1001) }]) {
    const res = await fetch(`${base}/api/ai/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
  }
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
});
