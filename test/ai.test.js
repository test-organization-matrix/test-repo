'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWithRules, extractDueDate, extractPriority, extractTags, parseTask, summarize } = require('../src/ai');

const NOW = new Date(2026, 10, 13); // Fri 13 Nov 2026

test('extracts "tomorrow" relative to now', () => {
  assert.equal(extractDueDate('call mum tomorrow', NOW), '2026-11-14');
});

test('extracts "today" and "next week"', () => {
  assert.equal(extractDueDate('finish today', NOW), '2026-11-13');
  assert.equal(extractDueDate('review next week', NOW), '2026-11-20');
});

test('extracts "in N days/weeks"', () => {
  assert.equal(extractDueDate('pay rent in 3 days', NOW), '2026-11-16');
  assert.equal(extractDueDate('trip in 2 weeks', NOW), '2026-11-27');
});

test('extracts weekday names to the next occurrence', () => {
  // NOW is a Friday; "monday" should be the coming Monday.
  assert.equal(extractDueDate('standup monday', NOW), '2026-11-16');
  // Same weekday without "next" rolls a full week.
  assert.equal(extractDueDate('gym friday', NOW), '2026-11-20');
});

test('extracts explicit ISO and slash dates', () => {
  assert.equal(extractDueDate('deploy on 2026-12-01', NOW), '2026-12-01');
  assert.equal(extractDueDate('party 25/12/2026', NOW), '2026-12-25');
  // Month-first when the first number cannot be a month.
  assert.equal(extractDueDate('deadline 12/25/2026', NOW), '2026-12-25');
});

test('returns null when there is no date', () => {
  assert.equal(extractDueDate('buy milk', NOW), null);
});

test('extracts priority keywords', () => {
  assert.equal(extractPriority('URGENT fix bug'), 'high');
  assert.equal(extractPriority('someday learn piano'), 'low');
  assert.equal(extractPriority('write report'), null);
});

test('extracts hashtags and tag: syntax, deduped', () => {
  assert.deepEqual(extractTags('ship #work #work tag: ops'), ['work', 'ops']);
  assert.deepEqual(extractTags('no tags here'), []);
});

test('parseWithRules returns a complete draft', () => {
  const draft = parseWithRules('Email the client tomorrow #work important', NOW);
  assert.equal(draft.priority, 'high');
  assert.equal(draft.dueDate, '2026-11-14');
  assert.deepEqual(draft.tags, ['work']);
  assert.equal(draft.engine, 'rules');
  assert.ok(draft.title.length > 0);
});

test('parseTask uses the rules engine when no API key is set', async () => {
  const draft = await parseTask('buy milk', { ai: {}, now: NOW });
  assert.equal(draft.engine, 'rules');
});

test('parseTask falls back to rules when the LLM call fails', async () => {
  const failingFetch = async () => ({ ok: false, status: 500 });
  const draft = await parseTask('buy milk tomorrow', {
    ai: { apiKey: 'x', baseUrl: 'https://example.invalid', model: 'm' },
    now: NOW,
    fetchImpl: failingFetch,
  });
  assert.equal(draft.engine, 'rules');
  assert.equal(draft.dueDate, '2026-11-14');
});

test('parseTask uses the LLM result when it succeeds', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        title: 'Go to the gym', priority: 'high', dueDate: '2026-11-14', tags: ['health'], notes: '',
      }) } }],
    }),
  });
  const draft = await parseTask('gym thing tomorrow', {
    ai: { apiKey: 'x', baseUrl: 'https://example.invalid', model: 'm' },
    now: NOW,
    fetchImpl: fakeFetch,
  });
  assert.equal(draft.engine, 'llm');
  assert.equal(draft.title, 'Go to the gym');
  assert.equal(draft.priority, 'high');
});

test('summarize falls back to a template with no key', async () => {
  const out = await summarize([{ title: 'a', done: false, priority: 'high' }], { ai: {} });
  assert.equal(out.engine, 'rules');
  assert.match(out.summary, /1 open task/);
});
