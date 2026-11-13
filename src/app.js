'use strict';

const path = require('node:path');
const express = require('express');
const { TodoStore } = require('./db');
const { parseTask, summarize, summarizeToday } = require('./ai');

const PRIORITIES = new Set(['low', 'medium', 'high']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate/normalise a user-supplied todo body. Returns { value } or { error }. */
function validateTodoInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object.' };
  }
  const value = {};

  if (body.title !== undefined || !partial) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      return { error: '"title" is required and must be a non-empty string.' };
    }
    if (body.title.length > 200) return { error: '"title" must be 200 characters or fewer.' };
    value.title = body.title.trim();
  }

  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return { error: '"notes" must be a string.' };
    if (body.notes.length > 5000) return { error: '"notes" is too long.' };
    value.notes = body.notes;
  }

  if (body.priority !== undefined) {
    if (!PRIORITIES.has(body.priority)) return { error: '"priority" must be low, medium or high.' };
    value.priority = body.priority;
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate !== null && (typeof body.dueDate !== 'string' || !DATE_RE.test(body.dueDate))) {
      return { error: '"dueDate" must be null or a YYYY-MM-DD date.' };
    }
    value.dueDate = body.dueDate;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string')) {
      return { error: '"tags" must be an array of strings.' };
    }
    value.tags = [...new Set(body.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  }

  if (body.done !== undefined) {
    if (typeof body.done !== 'boolean') return { error: '"done" must be a boolean.' };
    value.done = body.done;
  }

  return { value };
}

function createApp({ store, ai = {} } = {}) {
  const app = express();
  const todos = store || new TodoStore(process.env.DB_PATH || ':memory:');

  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, aiEnabled: Boolean(ai.apiKey) });
  });

  app.get('/api/todos', (req, res) => {
    const { done, priority, tag, q, sort } = req.query;
    const filters = {};
    if (done === 'true') filters.done = true;
    else if (done === 'false') filters.done = false;
    if (priority) filters.priority = String(priority);
    if (tag) filters.tag = String(tag);
    if (q) filters.q = String(q);
    if (sort) filters.sort = String(sort);
    res.json({ todos: todos.list(filters), stats: todos.stats() });
  });

  app.get('/api/todos/:id', (req, res) => {
    const todo = todos.get(Number(req.params.id));
    if (!todo) return res.status(404).json({ error: 'Todo not found.' });
    res.json(todo);
  });

  app.post('/api/todos', (req, res) => {
    const { value, error } = validateTodoInput(req.body);
    if (error) return res.status(400).json({ error });
    res.status(201).json(todos.create(value));
  });

  // The AI endpoint: takes free text and returns a *draft* todo (not saved).
  app.post('/api/ai/parse', asyncRoute(async (req, res) => {
    const text = req.body && req.body.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: '"text" is required.' });
    }
    if (text.length > 1000) return res.status(400).json({ error: '"text" is too long.' });
    const draft = await parseTask(text, { ai });
    res.json(draft);
  }));

  // Parse a sentence AND save it in one go.
  app.post('/api/ai/add', asyncRoute(async (req, res) => {
    const text = req.body && req.body.text;
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: '"text" is required.' });
    }
    if (text.length > 1000) return res.status(400).json({ error: '"text" is too long.' });
    const draft = await parseTask(text, { ai });
    const todo = todos.create({
      title: draft.title,
      notes: draft.notes,
      priority: draft.priority,
      dueDate: draft.dueDate,
      tags: draft.tags,
    });
    res.status(201).json({ todo, engine: draft.engine });
  }));

  app.post('/api/ai/summary', asyncRoute(async (req, res) => {
    const result = await summarize(todos.list(), { ai });
    res.json(result);
  }));

  // Today's todo summary: counts + the actual lists for the day.
  app.get('/api/today', (req, res) => {
    res.json(todos.todayOverview());
  });

  // AI recap of today: one short sentence built from the day's overview.
  app.post('/api/ai/today', asyncRoute(async (req, res) => {
    const overview = todos.todayOverview();
    const { summary, engine } = await summarizeToday(overview, { ai });
    res.json({ summary, engine, counts: overview.counts, date: overview.date });
  }));

  app.patch('/api/todos/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!todos.get(id)) return res.status(404).json({ error: 'Todo not found.' });
    const { value, error } = validateTodoInput(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    res.json(todos.update(id, value));
  });

  app.delete('/api/todos/:id', (req, res) => {
    if (!todos.remove(Number(req.params.id))) return res.status(404).json({ error: 'Todo not found.' });
    res.status(204).end();
  });

  app.post('/api/todos/clear-completed', (req, res) => {
    res.json({ removed: todos.clearCompleted() });
  });

  // JSON 404 for unknown API routes; everything else falls back to the SPA.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON in request body.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

module.exports = { createApp, validateTodoInput };
