/**
 * Tests for logic.js, run with the built-in Node test runner:
 *
 *   node --test
 *
 * No npm packages involved — `node:test` and `node:assert` ship with Node.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  GRID_DAYS,
  STORAGE_KEY,
  addDays,
  addHabit,
  createHabit,
  currentStreak,
  daysBetween,
  deserialize,
  emptyState,
  findHabit,
  isDone,
  isValidKey,
  longestStreak,
  parseKey,
  recentDays,
  removeHabit,
  serialize,
  setDay,
  startOfDay,
  toKey,
  toggleDay,
  updateHabit,
} from './logic.js';

// --- helpers ---------------------------------------------------------------

/** A habit marked done on each of the given 'MM-DD' or 'YYYY-MM-DD' keys. */
function habitDoneOn(...partialKeys) {
  const days = partialKeys.map((k) => (k.length === 5 ? `2026-${k}` : k));
  return { id: 'h_test', name: 'Test', emoji: '✅', days, createdAt: '2026-01-01' };
}

// --- dates -----------------------------------------------------------------

test('toKey formats a date as a local YYYY-MM-DD key', () => {
  assert.equal(toKey(new Date(2026, 8, 27)), '2026-09-27');
  assert.equal(toKey(new Date(2026, 0, 5)), '2026-01-05'); // zero padding
  assert.equal(toKey('2026-09-27'), '2026-09-27');
});

test('addDays crosses month, year and leap-day boundaries', () => {
  assert.equal(toKey(addDays('2026-09-30', 1)), '2026-10-01');
  assert.equal(toKey(addDays('2026-01-01', -1)), '2025-12-31');
  assert.equal(toKey(addDays('2026-02-28', 1)), '2026-03-01');
  assert.equal(toKey(addDays('2024-02-28', 1)), '2024-02-29'); // leap year
  assert.equal(daysBetween('2026-09-01', '2026-10-01'), 30);
});

test('parseKey rejects malformed and impossible dates', () => {
  assert.ok(parseKey('2026-09-27') instanceof Date);
  assert.equal(parseKey('2026-02-30'), null, 'Feb 30 does not exist');
  assert.equal(parseKey('2026-13-01'), null, 'month 13 does not exist');
  assert.equal(parseKey('26-09-27'), null, 'two-digit year rejected');
  assert.equal(parseKey('today'), null);
  assert.equal(isValidKey(undefined), false);
});

// --- the day grid ----------------------------------------------------------

test('recentDays returns 7 days, oldest first, ending today', () => {
  const days = recentDays(GRID_DAYS, '2026-09-27');
  assert.equal(days.length, 7);
  assert.equal(days[0].key, '2026-09-21');
  assert.equal(days[6].key, '2026-09-27');
  assert.equal(days.at(-1).isToday, true);
  assert.equal(days.filter((d) => d.isToday).length, 1);
  assert.equal(days.filter((d) => d.weekday).length, 7);
});

test('the grid rolls over a month boundary correctly', () => {
  const days = recentDays(7, '2026-10-01');
  assert.deepEqual(
    days.map((d) => d.key),
    ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'],
  );
});

// --- creating and deleting habits -----------------------------------------

test('createHabit trims the name and refuses an empty one', () => {
  const habit = createHabit('  Drink   water  ', '💧');
  assert.equal(habit.name, 'Drink water');
  assert.equal(habit.emoji, '💧');
  assert.deepEqual(habit.days, []);
  assert.ok(habit.id, 'an id is generated');

  assert.equal(createHabit('   '), null, 'empty habit is rejected');
  assert.equal(createHabit(''), null);
  assert.equal(createHabit(undefined), null);
  assert.equal(createHabit('ok', '').emoji, '✅', 'emoji falls back');
});

test('a brand new habit has a zero streak and nothing ticked', () => {
  const habit = createHabit('Read');
  assert.equal(currentStreak(habit, '2026-09-27'), 0);
  assert.equal(longestStreak(habit), 0);
  assert.equal(isDone(habit, '2026-09-27'), false);
});

test('habits can be added to and removed from state', () => {
  const a = createHabit('Read', '📖', { id: 'a' });
  const b = createHabit('Run', '🏃', { id: 'b' });
  const one = addHabit(emptyState(), a);
  const two = addHabit(one, b);

  assert.equal(two.habits.length, 2);
  assert.equal(findHabit(two, 'b').name, 'Run');

  const fewer = removeHabit(two, 'a');
  assert.equal(fewer.habits.length, 1);
  assert.equal(findHabit(fewer, 'a'), null);
  assert.equal(two.habits.length, 2, 'the original state is untouched');
});

// --- toggling --------------------------------------------------------------

test('toggleDay flips a day on and off, without mutating the habit', () => {
  const habit = createHabit('Read', '📖');
  const on = toggleDay(habit, '2026-09-27');
  assert.equal(isDone(on, '2026-09-27'), true);

  const off = toggleDay(on, '2026-09-27');
  assert.equal(isDone(off, '2026-09-27'), false);
  assert.deepEqual(habit.days, [], 'original habit never mutated');
  assert.deepEqual(on.days, ['2026-09-27']);
});

test('toggleDay ignores invalid date keys instead of corrupting the record', () => {
  const habit = habitDoneOn('2026-09-27');
  for (const bad of ['nonsense', '2026-02-30', '', null, 12345]) {
    const next = toggleDay(habit, bad);
    assert.deepEqual(next.days, habit.days, `${bad} must be ignored`);
  }
});

test('setDay sets and clears idempotently', () => {
  const habit = createHabit('Read');
  const on = setDay(habit, '2026-09-27', true);
  assert.equal(isDone(on, '2026-09-27'), true);
  assert.equal(setDay(on, '2026-09-27', true), on, 'setting twice is a no-op');
  assert.equal(isDone(setDay(on, '2026-09-27', false), '2026-09-27'), false);
});

test('updateHabit swaps one habit by id', () => {
  const state = addHabit(addHabit(emptyState(), createHabit('Read', '📖', { id: 'a' })),
    createHabit('Run', '🏃', { id: 'b' }));
  const ticked = toggleDay(findHabit(state, 'a'), '2026-09-27');
  const next = updateHabit(state, ticked);

  assert.equal(findHabit(next, 'a').days.length, 1);
  assert.deepEqual(findHabit(next, 'b').days, [], 'the other habit is untouched');
});

// --- streaks ---------------------------------------------------------------

test('currentStreak counts consecutive days up to today', () => {
  const habit = habitDoneOn('2026-09-25', '2026-09-26', '2026-09-27');
  assert.equal(currentStreak(habit, '2026-09-27'), 3);
});

test('currentStreak stops at the first missed day', () => {
  // 21st and 22nd done, 23rd missed, then 24th–27th done again.
  const habit = habitDoneOn('2026-09-21', '2026-09-22', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27');
  assert.equal(currentStreak(habit, '2026-09-27'), 4);
  assert.equal(currentStreak(habit, '2026-09-24'), 1, 'the older run is not the current one');
});

test('EDGE: an empty habit has a zero streak', () => {
  assert.equal(currentStreak(createHabit('Nothing'), '2026-09-27'), 0);
  assert.equal(currentStreak({ id: 'x', days: [] }, '2026-09-27'), 0);
  assert.equal(currentStreak(null, '2026-09-27'), 0);
  assert.equal(currentStreak(undefined, '2026-09-27'), 0);
});

test('EDGE: a streak survives a month boundary', () => {
  // 28, 29, 30 Sep then 1, 2 Oct — five consecutive days, two months.
  const habit = habitDoneOn(
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
  );
  assert.equal(currentStreak(habit, '2026-10-02'), 5);

  // The same run read from the last day of September.
  assert.equal(currentStreak(habit, '2026-09-30'), 3);
  // And a streak that crosses a year boundary.
  const newYear = habitDoneOn('2025-12-30', '2025-12-31', '2026-01-01');
  assert.equal(currentStreak(newYear, '2026-01-01'), 3);
});

test('EDGE: today not done keeps yesterday’s streak (until midnight)', () => {
  const habit = habitDoneOn('2026-09-24', '2026-09-25', '2026-09-26');
  // Today is the 27th and has not been ticked yet: the chain is unbroken.
  assert.equal(currentStreak(habit, '2026-09-27'), 3, 'lenient default');
  assert.equal(
    currentStreak(habit, '2026-09-27', { todayPending: true }),
    3,
    'explicitly lenient',
  );
  assert.equal(
    currentStreak(habit, '2026-09-27', { todayPending: false }),
    0,
    'strict mode: no tick today, no streak',
  );

  // Missed today *and* yesterday — nothing to carry forward.
  const stale = habitDoneOn('2026-09-20', '2026-09-21');
  assert.equal(currentStreak(stale, '2026-09-27'), 0);
  assert.equal(currentStreak(stale, '2026-09-27', { todayPending: false }), 0);
});

test('EDGE: a streak in the future does not count towards today', () => {
  const habit = habitDoneOn('2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29');
  assert.equal(currentStreak(habit, '2026-09-27'), 2);
});

test('longestStreak finds the best run anywhere in the record', () => {
  const habit = habitDoneOn(
    '2026-09-20', '2026-09-21', '2026-09-22', // 3
    '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', // 4
  );
  assert.equal(longestStreak(habit), 4);
  assert.equal(currentStreak(habit, '2026-09-27'), 4);
  assert.equal(longestStreak(createHabit('none')), 0);
});

test('habits keep the order they were added in', () => {
  let state = emptyState();
  for (const name of ['Walk', 'Read', 'Run']) {
    state = addHabit(state, createHabit(name, '✅', { id: name }));
  }
  // No hidden re-sorting: ticking a day must never move somebody's card.
  assert.deepEqual(state.habits.map((h) => h.name), ['Walk', 'Read', 'Run']);
});
// --- persistence -----------------------------------------------------------

test('state survives a serialise / deserialise round trip', () => {
  const original = addHabit(
    addHabit(emptyState(), toggleDay(createHabit('Read', '📖', { id: 'a' }), '2026-09-27')),
    createHabit('Run', '🏃', { id: 'b' }),
  );
  const restored = deserialize(serialize(original));

  assert.equal(restored.habits.length, 2);
  assert.equal(restored.habits[0].name, 'Read');
  assert.deepEqual(restored.habits[0].days, ['2026-09-27']);
  assert.equal(currentStreak(restored.habits[0], '2026-09-27'), 1);
  assert.equal(restored.habits[1].emoji, '🏃');
  assert.equal(restored.version, 1);
});

test('corrupt saved data degrades to an empty state instead of throwing', () => {
  for (const junk of ['', '   ', 'not json', 'null', '42', '{"habits":"nope"}', '{}']) {
    assert.deepEqual(deserialize(junk), emptyState(), `${junk} → empty state`);
  }
});

test('saved data with bad habits and bad dates is repaired, not trusted', () => {
  const restored = deserialize(JSON.stringify({
    version: 1,
    habits: [
      { id: 'a', name: '  Read  ', emoji: '📖', days: ['2026-09-27', '2026-02-30', 'junk', '2026-09-27'] },
      { id: 'b', name: '   ' },          // no name → dropped
      'not an object',                  // → dropped
      null,
    ],
  }));

  assert.equal(restored.habits.length, 1);
  assert.equal(restored.habits[0].name, 'Read');
  assert.deepEqual(
    restored.habits[0].days,
    ['2026-09-27'],
    'impossible and duplicate dates removed',
  );
});

test('a legacy bare array of habits still loads', () => {
  const restored = deserialize('[{"name":"Walk","emoji":"🚶","days":["2026-09-27"]}]');
  assert.equal(restored.habits.length, 1);
  assert.equal(restored.habits[0].name, 'Walk');
  assert.ok(restored.habits[0].id, 'a missing id is generated');
});

// --- module hygiene --------------------------------------------------------

test('logic.js contains no DOM access', async () => {
  const source = await readFile(fileURLToPath(new URL('./logic.js', import.meta.url)), 'utf8');
  // Strip comments so prose about the DOM does not trip the check.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['document', 'window', 'localStorage', 'navigator', 'fetch(']) {
    assert.equal(code.includes(forbidden), false, `logic.js must not reference ${forbidden}`);
  }
});

test('the storage key is namespaced and versioned', () => {
  assert.equal(STORAGE_KEY, 'habit-tracker:v1');
  assert.equal(GRID_DAYS, 7);
  assert.equal(startOfDay('2026-09-27 17:45').getHours(), 0);
});
