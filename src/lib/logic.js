/**
 * logic.js — pure habit-tracking logic.
 *
 * Hard rule for this file: no DOM access. No `document`, no `window`,
 * no `localStorage`, no timers, no network. Everything in here is a plain
 * function over plain data, which is what makes it testable with `node --test`.
 *
 * Dates are handled in the *local* timezone and keyed as 'YYYY-MM-DD' strings.
 * Using `toISOString()` would silently shift the day for anyone east or west
 * of UTC, which is the classic habit-tracker bug.
 */

export const STORAGE_KEY = 'habit-tracker:v1';
export const SCHEMA_VERSION = 1;

/** Default width of the day grid, in days. */
export const GRID_DAYS = 7;

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Coerce anything date-ish into a Date.
 * @param {Date|string|number} value
 * @returns {Date}
 */
function coerceDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('Invalid Date');
    return value;
  }
  if (typeof value === 'string') {
    // 'YYYY-MM-DD' is parsed as UTC by the spec, so rebuild it in local time.
    const parsed = parseKey(value);
    if (parsed) return parsed;
    const loose = new Date(value);
    if (Number.isNaN(loose.getTime())) throw new TypeError(`Unparseable date: ${value}`);
    return loose;
  }
  return new Date(value);
}

/** Midnight, local time, of the given date. */
export function startOfDay(value = new Date()) {
  const d = coerceDate(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 'YYYY-MM-DD' for a date, in local time. */
export function toKey(value = new Date()) {
  const d = coerceDate(value);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Parse 'YYYY-MM-DD' into a local-midnight Date. Returns null when the string
 * is not a well-formed key (so callers can reject junk from localStorage).
 */
export function parseKey(key) {
  if (typeof key !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  // Rejects impossible dates such as 2026-02-30, which Date would roll over.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** True when `key` is a well-formed date key. */
export function isValidKey(key) {
  return parseKey(key) !== null;
}

/** Shift a date by whole days. Safe across month, year and DST boundaries. */
export function addDays(value, amount) {
  const d = startOfDay(value);
  d.setDate(d.getDate() + amount);
  return d;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from, to) {
  const a = startOfDay(from);
  const b = startOfDay(to);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * The `count` day-keys ending at `today`, oldest first.
 * This is the row of squares the user ticks.
 */
export function recentDays(count = GRID_DAYS, today = new Date()) {
  const end = startOfDay(today);
  const total = Number.isInteger(count) && count > 0 ? count : GRID_DAYS;
  const days = [];
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = addDays(end, -offset);
    days.push({
      key: toKey(date),
      date,
      weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
      dayOfMonth: date.getDate(),
      isToday: offset === 0,
    });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Habits
// ---------------------------------------------------------------------------

/** Trim, collapse inner whitespace, and cap length. */
export function normalizeName(name) {
  return String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function makeId(seed) {
  const base = seed == null ? '' : String(seed);
  return `h_${base}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Build a habit. Returns `null` if the name is empty after trimming.
 * @returns {{id:string,name:string,emoji:string,days:string[],createdAt:string}|null}
 */
export function createHabit(name, emoji = '✅', options = {}) {
  const clean = normalizeName(name);
  if (!clean) return null;
  return {
    id: options.id ?? makeId(),
    name: clean,
    emoji: String(emoji ?? '').trim() || '✅',
    days: Array.isArray(options.days) ? options.days.filter(isValidKey) : [],
    createdAt: options.createdAt ?? toKey(new Date()),
  };
}

/** Is this habit marked done on this day key? */
export function isDone(habit, key) {
  return Array.isArray(habit?.days) && habit.days.includes(key);
}

/**
 * Flip a day on/off. Pure: returns a new habit, leaves the original alone.
 * Invalid keys are ignored, so a bad click can never corrupt the record.
 */
export function toggleDay(habit, key) {
  if (!habit) return habit;
  if (!isValidKey(key)) return habit;
  const days = isDone(habit, key)
    ? habit.days.filter((d) => d !== key)
    : [...habit.days, key].sort();
  return { ...habit, days };
}

/** Set (or clear) a day explicitly. */
export function setDay(habit, key, done) {
  if (!isValidKey(key)) return habit;
  const has = isDone(habit, key);
  if (has === Boolean(done)) return habit;
  return toggleDay(habit, key);
}

/**
 * Current streak: consecutive done days counting back from today.
 *
 * `todayPending` decides what happens when today has not been ticked yet:
 *   true  (default) — the streak survives until midnight. This is what people
 *                     expect from a habit app: it is still 19:00, you have all
 *                     day, so yesterday's 5 days still stand.
 *   false          — strict: no tick today means no streak.
 *
 * @param {{days:string[]}} habit
 * @param {Date|string} today
 * @param {{todayPending?: boolean}} [options]
 * @returns {number}
 */
export function currentStreak(habit, today = new Date(), options = {}) {
  const { todayPending = true } = options;
  const done = new Set(Array.isArray(habit?.days) ? habit.days : []);
  if (done.size === 0) return 0;

  const end = startOfDay(today);
  let cursor = done.has(toKey(end)) ? end : addDays(end, -1);

  // Not done today and not done yesterday: the chain is already broken.
  if (!done.has(toKey(cursor))) return 0;
  if (!done.has(toKey(end)) && !todayPending) return 0;

  let streak = 0;
  // Bounded so a corrupt record can never spin this into an infinite loop.
  while (streak < 36500 && done.has(toKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Longest run of done days anywhere in the record. */
export function longestStreak(habit) {
  const days = Array.isArray(habit?.days) ? habit.days.filter(isValidKey).sort() : [];
  let best = 0;
  let run = 0;
  let previous = null;
  for (const key of days) {
    const current = parseKey(key);
    run = previous && daysBetween(previous, current) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = current;
  }
  return best;
}

/** Done days within the visible grid. */
export function completedInGrid(habit, days) {
  return days.reduce((sum, day) => (isDone(habit, day.key) ? sum + 1 : sum), 0);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function emptyState() {
  return { version: SCHEMA_VERSION, habits: [] };
}

/** Add a habit to the state. Returns a new state. */
export function addHabit(state, habit) {
  if (!habit) return state;
  const habits = Array.isArray(state?.habits) ? state.habits : [];
  return { ...state, version: SCHEMA_VERSION, habits: [...habits, habit] };
}

/** Remove a habit by id. Returns a new state. */
export function removeHabit(state, id) {
  const habits = Array.isArray(state?.habits) ? state.habits : [];
  return { ...state, habits: habits.filter((habit) => habit.id !== id) };
}

/** Replace one habit with an updated copy (matched by id). */
export function updateHabit(state, updated) {
  const habits = Array.isArray(state?.habits) ? state.habits : [];
  return {
    ...state,
    habits: habits.map((habit) => (habit.id === updated.id ? updated : habit)),
  };
}

/** Look up a habit by id. */
export function findHabit(state, id) {
  const habits = Array.isArray(state?.habits) ? state.habits : [];
  return habits.find((habit) => habit.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Coerce one possibly-corrupt habit record into a safe one. */
function sanitizeHabit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = normalizeName(raw.name);
  if (!name) return null;
  const days = Array.from(
    new Set(
      (Array.isArray(raw.days) ? raw.days : []).filter(isValidKey).sort(),
    ),
  );
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : makeId(),
    name,
    emoji: typeof raw.emoji === 'string' && raw.emoji.trim() ? raw.emoji.trim() : '✅',
    days,
    createdAt: isValidKey(raw.createdAt) ? raw.createdAt : toKey(new Date()),
  };
}

/**
 * Parse a saved state. Never throws: corrupt data yields an empty state,
 * because losing your habits silently is better than a blank white page.
 */
export function deserialize(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return emptyState();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  const habits = Array.isArray(parsed) ? parsed : parsed?.habits;
  if (!Array.isArray(habits)) return emptyState();
  return {
    version: SCHEMA_VERSION,
    habits: habits.map(sanitizeHabit).filter(Boolean),
  };
}

/** Serialise to a JSON string. */
export function serialize(state) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    habits: (state?.habits ?? []).map(sanitizeHabit).filter(Boolean),
  });
}
