'use strict';

/**
 * Natural-language engine.
 *
 * Two strategies, chosen automatically:
 *   1. "llm"      - an OpenAI-compatible chat completion, used when AI_API_KEY is set.
 *   2. "rules"    - a deterministic offline parser, used otherwise or if the LLM fails.
 *
 * Both return the same shape, so callers never care which ran:
 *   { title, priority: 'low'|'medium'|'high', dueDate: 'YYYY-MM-DD'|null,
 *     tags: string[], notes: string }
 */

const PRIORITY_WORDS = {
  high: ['urgent', 'asap', 'critical', 'important', 'high priority', 'high-priority', 'must', 'immediately'],
  low: ['someday', 'whenever', 'low priority', 'low-priority', 'eventually', 'nice to have', 'no rush', 'minor'],
  medium: ['medium priority', 'normal'],
};

const DAY_WORDS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Parse the date/time hints in a sentence. `now` is injectable so tests are stable.
 */
function extractDueDate(text, now = new Date()) {
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/\btoday\b/.test(t)) return toISODate(today);
  if (/\btomorrow\b/.test(t)) return toISODate(addDays(today, 1));
  if (/\byesterday\b/.test(t)) return toISODate(addDays(today, -1));
  if (/\bday after tomorrow\b/.test(t)) return toISODate(addDays(today, 2));
  if (/\bnext week\b/.test(t)) return toISODate(addDays(today, 7));
  if (/\bnext month\b/.test(t)) return toISODate(addDays(today, 30));
  if (/\bthis weekend\b/.test(t)) {
    const daysToSat = (6 - today.getDay() + 7) % 7;
    return toISODate(addDays(today, daysToSat));
  }

  let m = t.match(/\bin (\d+) (day|days|week|weeks|month|months)\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const mult = unit.startsWith('day') ? 1 : unit.startsWith('week') ? 7 : 30;
    return toISODate(addDays(today, n * mult));
  }

  m = t.match(/\b(?:on |by |due )?(?:next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/);
  if (m) {
    const target = DAY_WORDS[m[1]];
    let delta = (target - today.getDay() + 7) % 7;
    const isNext = /\bnext\b/.test(t);
    if (delta === 0 && !isNext) delta = 7;
    if (isNext && delta === 0) delta = 7;
    return toISODate(addDays(today, delta));
  }

  // Explicit date: 2026-11-20, 20/11/2026, 11/20/2026
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = t.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    // Assume D/M/Y when the first part cannot be a month.
    const month = a > 12 ? b : b > 12 ? a : b;
    const day = a > 12 ? a : b > 12 ? b : a;
    return toISODate(new Date(parseInt(m[3], 10), month - 1, day));
  }

  return null;
}

function extractPriority(text) {
  const t = text.toLowerCase();
  for (const [level, words] of Object.entries(PRIORITY_WORDS)) {
    if (words.some((w) => t.includes(w))) return level;
  }
  return null;
}

function extractTags(text) {
  const tags = [];
  const re = /#([\p{L}\p{N}_-]+)/gu;
  let m;
  while ((m = re.exec(text)) !== null) tags.push(m[1].toLowerCase());
  // "tag: x" style
  const re2 = /\btag[s]?:\s*([\p{L}\p{N}_-]+)/gu;
  while ((m = re2.exec(text)) !== null) tags.push(m[1].toLowerCase());
  return [...new Set(tags)];
}

function cleanTitle(text) {
  const original = text.trim();
  // Let the model/parse keep the original wording but strip obvious metadata noise.
  return original.replace(/\s+/g, ' ').replace(/^[-*•\d.)\s]+/, '').trim();
}

/** Offline, deterministic parser used as the default engine and as LLM fallback. */
function parseWithRules(text, now = new Date()) {
  const title = cleanTitle(text);
  return {
    title: title.slice(0, 200),
    priority: extractPriority(text) || 'medium',
    dueDate: extractDueDate(text, now),
    tags: extractTags(text),
    notes: '',
    engine: 'rules',
  };
}

const SYSTEM_PROMPT = `You extract structured todo data from a user's sentence.
Return ONLY a JSON object with these keys:
- "title": the task itself, concise, without the date/priority/tag metadata words
- "priority": one of "low", "medium", "high"
- "dueDate": "YYYY-MM-DD" or null
- "tags": array of short lowercase strings (may be empty)
- "notes": extra detail or "" if none
Never include markdown fences or commentary.`;

/**
 * Parse with an OpenAI-compatible endpoint. Throws on any failure so the
 * caller can fall back to rules.
 */
async function parseWithLLM(text, {
  apiKey,
  baseUrl = 'https://api.openai.com/v1',
  model = 'gpt-4o-mini',
  now = new Date(),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('no api key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Today is ${toISODate(now)} (${now.toISOString().slice(0, 10)}). Sentence: ${text}` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error('empty LLM response');
    const parsed = JSON.parse(raw);
    const priority = ['low', 'medium', 'high'].includes(parsed.priority) ? parsed.priority : 'medium';
    return {
      title: String(parsed.title || text).slice(0, 200),
      priority,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.dueDate) ? parsed.dueDate : null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((x) => String(x).toLowerCase()).slice(0, 10) : [],
      notes: String(parsed.notes || ''),
      engine: 'llm',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one entry point the API uses. Picks the best available strategy and
 * never throws: a network or provider error degrades to the rules engine.
 */
async function parseTask(text, options = {}) {
  const { ai = {}, now = new Date(), fetchImpl } = options;
  if (ai.apiKey) {
    try {
      return await parseWithLLM(text, { ...ai, now, fetchImpl });
    } catch {
      // fall through to rules
    }
  }
  return parseWithRules(text, now);
}

/**
 * Give the user a short, AI-generated summary of their list. Falls back to a
 * plain templated sentence when no key is configured.
 */
async function summarize(todos, options = {}) {
  const { ai = {}, fetchImpl } = options;
  const open = todos.filter((t) => !t.done);
  const high = open.filter((t) => t.priority === 'high');
  const fallback = open.length === 0
    ? 'All clear - nothing left on your list.'
    : `You have ${open.length} open task${open.length === 1 ? '' : 's'}` +
      (high.length ? `, ${high.length} of them high priority.` : '.');

  if (!ai.apiKey || todos.length === 0) return { summary: fallback, engine: 'rules' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const compact = open.slice(0, 30).map((t) =>
      `- ${t.title} [${t.priority}]${t.dueDate ? ` due ${t.dueDate}` : ''}`);
    const res = await fetchImpl(`${ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are a concise productivity assistant. Reply in 1-2 sentences. No markdown.' },
          { role: 'user', content: `My open todos:\n${compact.join('\n')}\n\nSuggest what to focus on.` },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error('empty');
    return { summary: out, engine: 'llm' };
  } catch {
    return { summary: fallback, engine: 'rules' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  parseTask,
  parseWithRules,
  parseWithLLM,
  summarize,
  extractDueDate,
  extractPriority,
  extractTags,
  toISODate,
};
