# ✅ AI Todo

An AI-powered todo app. Instead of filling in separate fields, you type a task
the way you'd say it:

> `Email the client about the invoice tomorrow #work urgent`

The AI turns that into a structured task — **title**, **priority**, **due date**
and **tags** — which you review and save. It also writes a short focus summary
of your open list.

![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen) ![Tests](https://img.shields.io/badge/tests-28%20passing-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Natural-language input** — dates ("tomorrow", "next week", "in 3 days", "friday"),
  priorities ("urgent", "someday") and `#tags` are parsed automatically.
- **Works with or without an AI key.** With `AI_API_KEY` set it calls any
  OpenAI-compatible model. With no key it uses a built-in deterministic parser,
  so the app never breaks and needs no account to try.
- **Review before saving** — the AI returns a *draft* you can edit, then save.
- **AI focus summary** — a one-line suggestion of what to tackle next.
- **Filters, sort and stats** — open/done/high-priority views, sort by priority
  or due date, live completion stats.
- **Zero-dependency storage** — Node's built-in SQLite (`node:sqlite`), so no
  native modules to compile.
- **Safe by design** — every write is validated server-side; malformed input is
  rejected with a clear 400, never a crash.

## Quick start

```bash
git clone https://github.com/test-organization-matrix/test-repo.git
cd test-repo
npm install
npm start
```

Open **http://localhost:3000**.

It runs immediately with the built-in engine. To use a real LLM:

```bash
cp .env.example .env
# edit .env and set AI_API_KEY (and optionally AI_MODEL / AI_BASE_URL)
npm start
```

### AI configuration

Any OpenAI-compatible API works — OpenAI, Groq, OpenRouter, Together, or a local
Ollama server:

| Variable      | Default                        | Purpose                              |
| ------------- | ------------------------------ | ------------------------------------ |
| `AI_API_KEY`  | *(empty)*                      | Enables the LLM engine when set      |
| `AI_BASE_URL` | `https://api.openai.com/v1`    | Any OpenAI-compatible endpoint       |
| `AI_MODEL`    | `gpt-4o-mini`                  | Model name                           |
| `PORT`        | `3000`                         | Web server port                      |
| `DB_PATH`     | `./data/todos.db`              | SQLite file location                 |

For a local Ollama server: `AI_BASE_URL=http://localhost:11434/v1` and
`AI_MODEL=llama3.1` (any key, e.g. `AI_API_KEY=ollama`).

## Tests

```bash
npm test
```

28 tests cover date/priority/tag parsing, the LLM path and its fallback,
the storage layer, and the HTTP API (CRUD, validation, malformed JSON, AI
draft-not-saved guarantee).

## API

| Method   | Path                       | Description                                  |
| -------- | -------------------------- | -------------------------------------------- |
| `GET`    | `/api/health`              | Service status + whether AI is enabled       |
| `GET`    | `/api/todos`               | List todos. Query: `done`, `priority`, `tag`, `q`, `sort` |
| `POST`   | `/api/todos`               | Create a todo from explicit fields           |
| `GET`    | `/api/todos/:id`           | Fetch one todo                               |
| `PATCH`  | `/api/todos/:id`           | Update fields / mark done                    |
| `DELETE` | `/api/todos/:id`           | Delete a todo                                |
| `POST`   | `/api/todos/clear-completed` | Delete all completed todos                 |
| `POST`   | `/api/ai/parse`            | Parse text → draft todo (**does not save**)  |
| `POST`   | `/api/ai/add`              | Parse text → draft → save in one call        |
| `POST`   | `/api/ai/summary`          | AI summary of the open list                  |

### Example

```bash
curl -X POST http://localhost:3000/api/ai/add \
  -H 'Content-Type: application/json' \
  -d '{"text":"Pay the electricity bill on friday urgent #home"}'
```

```json
{
  "todo": {
    "id": 1,
    "title": "Pay the electricity bill on friday urgent #home",
    "priority": "high",
    "dueDate": "2026-11-20",
    "tags": ["home"],
    "done": false
  },
  "engine": "rules"
}
```

## Project structure

```
src/
  ai.js      natural-language parsing (LLM + offline rules fallback)
  db.js      SQLite storage layer
  app.js     Express routes + validation
  server.js  config + startup
public/      frontend (vanilla HTML/CSS/JS, no build step)
test/        node:test suites
```

## How the AI engine works

`src/ai.js` exposes one `parseTask(text)` entry point. When `AI_API_KEY` is set
it asks the model for strict JSON; on any error (network, bad key, timeout) it
silently falls back to the offline rules engine. So the worst case is a slightly
less clever parse, never a failed request.

## License

MIT
