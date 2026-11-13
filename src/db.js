'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Thin persistence layer over Node's built-in SQLite (node:sqlite),
 * so the app has zero native/DB dependencies.
 */
class TodoStore {
  constructor(dbPath = ':memory:') {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        notes       TEXT    NOT NULL DEFAULT '',
        priority    TEXT    NOT NULL DEFAULT 'medium',
        due_date    TEXT,
        tags        TEXT    NOT NULL DEFAULT '',
        done        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL,
        completed_at TEXT
      );
    `);
  }

  #rowToTodo(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      priority: row.priority,
      dueDate: row.due_date || null,
      tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
      done: Boolean(row.done),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || null,
    };
  }

  create(input) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO todos (title, notes, priority, due_date, tags, done, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)
    `);
    const info = stmt.run(
      input.title,
      input.notes || '',
      input.priority || 'medium',
      input.dueDate || null,
      (input.tags || []).join(','),
      now,
      now,
    );
    return this.get(Number(info.lastInsertRowid));
  }

  get(id) {
    return this.#rowToTodo(this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id));
  }

  list({ done, priority, tag, q, sort = 'created' } = {}) {
    const where = [];
    const params = [];
    if (typeof done === 'boolean') {
      where.push('done = ?');
      params.push(done ? 1 : 0);
    }
    if (priority) {
      where.push('priority = ?');
      params.push(priority);
    }
    if (tag) {
      where.push("(',' || tags || ',') LIKE ?");
      params.push(`%,${tag},%`);
    }
    if (q) {
      where.push('(title LIKE ? OR notes LIKE ? OR tags LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const orderBy =
      sort === 'priority'
        ? "CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC"
        : sort === 'due'
          ? 'due_date IS NULL, due_date ASC, id DESC'
          : 'id DESC';

    const sql = `SELECT * FROM todos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${orderBy}`;
    return this.db.prepare(sql).all(...params).map((r) => this.#rowToTodo(r));
  }

  update(id, patch) {
    const existing = this.get(id);
    if (!existing) return null;

    const fields = {
      title: patch.title ?? existing.title,
      notes: patch.notes ?? existing.notes,
      priority: patch.priority ?? existing.priority,
      due_date: patch.dueDate !== undefined ? patch.dueDate : existing.dueDate,
      tags: patch.tags !== undefined ? patch.tags.join(',') : existing.tags.join(','),
      done: patch.done !== undefined ? (patch.done ? 1 : 0) : existing.done ? 1 : 0,
    };

    const completedAt =
      patch.done === true ? existing.completedAt || new Date().toISOString()
        : patch.done === false ? null
          : existing.completedAt;

    this.db.prepare(`
      UPDATE todos
      SET title = ?, notes = ?, priority = ?, due_date = ?, tags = ?, done = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      fields.title, fields.notes, fields.priority, fields.due_date,
      fields.tags, fields.done, completedAt, new Date().toISOString(), id,
    );
    return this.get(id);
  }

  remove(id) {
    const info = this.db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    return info.changes > 0;
  }

  clearCompleted() {
    const info = this.db.prepare('DELETE FROM todos WHERE done = 1').run();
    return Number(info.changes);
  }

  stats() {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN done = 0 AND priority = 'high' THEN 1 ELSE 0 END) AS highOpen
      FROM todos
    `).get();
    const total = Number(row.total || 0);
    const completed = Number(row.completed || 0);
    return {
      total,
      completed,
      open: total - completed,
      highOpen: Number(row.highOpen || 0),
      completionRate: total ? Math.round((completed / total) * 100) : 0,
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = { TodoStore };
