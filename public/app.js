'use strict';

const $ = (sel) => document.querySelector(sel);

const state = {
  todos: [],
  stats: { total: 0, completed: 0, open: 0, highOpen: 0, completionRate: 0 },
  filter: 'all',
  sort: 'created',
  draft: null,
};

/* ---------- API helpers ---------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/* ---------- Rendering ---------- */

const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDue(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function visibleTodos() {
  let list = state.todos;
  switch (state.filter) {
    case 'open': list = list.filter((t) => !t.done); break;
    case 'done': list = list.filter((t) => t.done); break;
    case 'high': list = list.filter((t) => t.priority === 'high' && !t.done); break;
    default: break;
  }
  if (state.sort === 'priority') {
    const rank = { high: 0, medium: 1, low: 2 };
    list = [...list].sort((a, b) => rank[a.priority] - rank[b.priority]);
  } else if (state.sort === 'due') {
    list = [...list].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }
  return list;
}

function render() {
  const list = $('#todoList');
  const items = visibleTodos();
  list.innerHTML = '';

  const today = todayISO();
  for (const todo of items) {
    const li = document.createElement('li');
    li.className = 'todo' + (todo.done ? ' is-done' : '');
    li.dataset.id = todo.id;
    li.dataset.priority = todo.priority;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'todo__check';
    check.checked = todo.done;
    check.setAttribute('aria-label', `Mark ${todo.title} ${todo.done ? 'not done' : 'done'}`);
    check.addEventListener('change', () => toggleTodo(todo.id, check.checked));

    const body = document.createElement('div');
    body.className = 'todo__body';

    const title = document.createElement('div');
    title.className = 'todo__title';
    title.textContent = todo.title;
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'todo__meta';

    const prio = document.createElement('span');
    prio.className = `pill pill--${todo.priority}`;
    prio.textContent = PRIORITY_LABEL[todo.priority];
    meta.appendChild(prio);

    if (todo.dueDate) {
      const overdue = !todo.done && todo.dueDate < today;
      const due = document.createElement('span');
      due.className = 'pill ' + (overdue ? 'pill--overdue' : 'pill--due');
      due.textContent = overdue ? `Overdue · ${formatDue(todo.dueDate)}` : `Due ${formatDue(todo.dueDate)}`;
      meta.appendChild(due);
    }

    for (const tag of todo.tags) {
      const t = document.createElement('span');
      t.className = 'pill pill--tag';
      t.textContent = '#' + tag;
      meta.appendChild(t);
    }

    body.appendChild(meta);
    li.appendChild(check);
    li.appendChild(body);

    const del = document.createElement('button');
    del.className = 'todo__delete';
    del.textContent = '✕';
    del.setAttribute('aria-label', `Delete ${todo.title}`);
    del.addEventListener('click', () => deleteTodo(todo.id));
    li.appendChild(del);

    list.appendChild(li);
  }

  $('#emptyState').hidden = items.length > 0;
  const s = state.stats;
  $('#statsLine').textContent = s.total
    ? `${s.completed}/${s.total} done · ${s.open} open · ${s.completionRate}% complete`
    : '';
}

/* ---------- Data actions ---------- */

async function load() {
  const data = await api('/api/todos');
  state.todos = data.todos;
  state.stats = data.stats;
  render();
}

async function toggleTodo(id, done) {
  try {
    await api(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) });
    await load();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteTodo(id) {
  try {
    await api(`/api/todos/${id}`, { method: 'DELETE' });
    await load();
  } catch (err) {
    toast(err.message, true);
  }
}

/* ---------- AI flow ---------- */

async function parseAndPreview() {
  const input = $('#aiInput');
  const text = input.value.trim();
  if (!text) return;
  const btn = $('#aiAddBtn');
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const draft = await api('/api/ai/parse', { method: 'POST', body: JSON.stringify({ text }) });
    state.draft = draft;
    $('#draftTitle').value = draft.title;
    $('#draftPriority').value = draft.priority;
    $('#draftDue').value = draft.dueDate || '';
    $('#draftTags').value = draft.tags.join(', ');
    $('#draftCard').hidden = false;
    $('#draftTitle').focus();
    $('#aiHint').textContent = draft.engine === 'llm'
      ? 'Parsed by the AI model — adjust anything below.'
      : 'Parsed by the built-in engine (no AI key) — adjust anything below.';
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add with AI';
  }
}

async function saveDraft() {
  const body = {
    title: $('#draftTitle').value.trim(),
    priority: $('#draftPriority').value,
    dueDate: $('#draftDue').value || null,
    tags: $('#draftTags').value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
  };
  if (!body.title) {
    toast('Title cannot be empty', true);
    return;
  }
  try {
    await api('/api/todos', { method: 'POST', body: JSON.stringify(body) });
    closeDraft();
    $('#aiInput').value = '';
    $('#aiHint').textContent = 'Press Enter to add. A preview appears before saving.';
    await load();
    toast('Task added');
  } catch (err) {
    toast(err.message, true);
  }
}

function closeDraft() {
  state.draft = null;
  $('#draftCard').hidden = true;
}

async function loadSummary() {
  try {
    const { summary } = await api('/api/ai/summary', { method: 'POST', body: '{}' });
    if (summary) {
      $('#summaryText').textContent = summary;
      $('#summaryCard').hidden = false;
    }
  } catch {
    /* summary is optional */
  }
}

/* ---------- Toast ---------- */

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('toast--error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- Wiring ---------- */

function init() {
  $('#aiAddBtn').addEventListener('click', parseAndPreview);
  $('#aiInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') parseAndPreview();
  });
  $('#draftSave').addEventListener('click', saveDraft);
  $('#draftCancel').addEventListener('click', closeDraft);

  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      $('#aiInput').value = chip.dataset.example;
      parseAndPreview();
    });
  }

  for (const btn of document.querySelectorAll('.filter')) {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.filter = btn.dataset.filter;
      render();
    });
  }

  $('#sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    render();
  });

  $('#clearBtn').addEventListener('click', async () => {
    try {
      const { removed } = await api('/api/todos/clear-completed', { method: 'POST' });
      await load();
      if (removed) toast(`Removed ${removed} completed task${removed === 1 ? '' : 's'}`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  api('/api/health').then((h) => {
    const badge = $('#engineBadge');
    badge.textContent = h.aiEnabled ? 'AI model connected' : 'built-in engine';
    badge.classList.toggle('badge--off', !h.aiEnabled);
  }).catch(() => {});

  load().then(loadSummary).catch((err) => toast(err.message, true));
}

init();
