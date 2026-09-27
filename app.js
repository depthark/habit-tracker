/**
 * app.js — the DOM layer.
 *
 * Everything here is presentation and wiring. The thinking lives in logic.js,
 * which knows nothing about the browser. This file never does arithmetic on
 * dates or streaks by hand; it asks logic.js and paints the answer.
 */

import {
  GRID_DAYS,
  STORAGE_KEY,
  addHabit,
  createHabit,
  currentStreak,
  deserialize,
  findHabit,
  isDone,
  recentDays,
  removeHabit,
  serialize,
  toggleDay,
  updateHabit,
} from './logic.js';

const THEME_KEY = 'habit-tracker:theme';
const THEMES = ['light', 'auto', 'dark'];

const els = {
  form: document.getElementById('add-habit-form'),
  name: document.getElementById('habit-name'),
  emoji: document.getElementById('habit-emoji'),
  error: document.getElementById('form-error'),
  list: document.getElementById('habits'),
  empty: document.getElementById('empty-state'),
  summary: document.getElementById('summary'),
  clearAll: document.getElementById('clear-all'),
  habitTemplate: document.getElementById('habit-template'),
  dayTemplate: document.getElementById('day-template'),
  dialog: document.getElementById('confirm-dialog'),
  dialogTitle: document.getElementById('confirm-title'),
  dialogBody: document.getElementById('confirm-body'),
  dialogAccept: document.getElementById('confirm-accept'),
  dialogCancel: document.getElementById('confirm-cancel'),
  themeButtons: [...document.querySelectorAll('[data-theme-choice]')],
};

let state = load();
let days = recentDays(GRID_DAYS, new Date());

// --- storage ---------------------------------------------------------------

function load() {
  try {
    return deserialize(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    // Private browsing, disabled storage, quota — none of it should stop the app.
    console.warn('Habit Tracker: could not read saved data.', error);
    return { version: 1, habits: [] };
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state));
  } catch (error) {
    console.warn('Habit Tracker: could not save data.', error);
    showError('Your browser is blocking storage, so changes will not be kept.');
  }
}

// --- theme -----------------------------------------------------------------

function applyTheme(theme) {
  document.documentElement.dataset.theme = THEMES.includes(theme) ? theme : 'auto';
  for (const button of els.themeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* a blocked storage must not break the switch */
  }
}

function initTheme() {
  let saved = 'auto';
  try {
    saved = localStorage.getItem(THEME_KEY) || 'auto';
  } catch {
    /* ignore */
  }
  applyTheme(THEMES.includes(saved) ? saved : 'auto');

  for (const button of els.themeButtons) {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
  }

  // When following the system, react to the OS flipping its setting live.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (document.documentElement.dataset.theme === 'auto') {
      els.themeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === 'auto')));
    }
  });
}

// --- rendering -------------------------------------------------------------

function render() {
  // Insertion order, deliberately: a list that reshuffles itself every time you
  // tick a day is maddening to use.
  const habits = state.habits;
  els.list.replaceChildren(...habits.map(renderHabit));
  els.empty.hidden = habits.length > 0;
  renderSummary(habits);
}

function renderHabit(habit) {
  const node = els.habitTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.habitId = habit.id;

  node.querySelector('.habit__emoji').textContent = habit.emoji;
  node.querySelector('.habit__name').textContent = habit.name;

  const streak = currentStreak(habit, new Date());
  node.dataset.streak = streak >= 3 ? 'hot' : 'cold';
  node.querySelector('.streak__count').textContent = String(streak);
  node.querySelector('.streak__label').textContent = 'day streak';

  node.querySelector('.habit__delete').addEventListener('click', () => askToDelete(habit));

  const week = node.querySelector('.week');
  for (const day of days) {
    week.append(renderDay(habit, day));
  }
  return node;
}

function renderDay(habit, day) {
  const node = els.dayTemplate.content.firstElementChild.cloneNode(true);
  const done = isDone(habit, day.key);
  node.classList.toggle('is-done', done);
  node.classList.toggle('is-today', day.isToday);

  const button = node.querySelector('.day__toggle');
  button.querySelector('.day__weekday').textContent = day.weekday;
  button.querySelector('.day__number').textContent = String(day.dayOfMonth);
  button.setAttribute('aria-pressed', String(done));
  button.setAttribute(
    'aria-label',
    `${habit.name} on ${day.key}${done ? ' — done, tap to undo' : ' — not done, tap to mark done'}`,
  );

  button.addEventListener('click', () => {
    const current = findHabit(state, habit.id);
    if (!current) return;
    state = updateHabit(state, toggleDay(current, day.key));
    save();
    // Repaint just this habit's card — cheaper and calmer than a full re-render.
    // `node` is the day cell, so climb to the card that owns it.
    const card = node.closest('.habit');
    if (card) els.list.replaceChild(renderHabit(findHabit(state, habit.id)), card);
    renderSummary(state.habits);
  });

  return node;
}

function renderSummary(habits) {
  if (habits.length === 0) {
    els.summary.textContent = 'No habits saved yet.';
    return;
  }
  const ticked = habits.reduce(
    (sum, habit) => sum + days.filter((d) => isDone(habit, d.key)).length,
    0,
  );
  const best = habits.reduce((max, h) => Math.max(max, currentStreak(h, new Date())), 0);
  els.summary.textContent =
    `${habits.length} habit${habits.length === 1 ? '' : 's'} · ` +
    `${ticked} tick${ticked === 1 ? '' : 's'} this week · ` +
    `best streak ${best}`;
}

// --- confirmation ----------------------------------------------------------

/** Promise-based confirm so callers can `await` a yes or no. */
function confirmAction({ title, body, acceptLabel = 'Delete' }) {
  els.dialogTitle.textContent = title;
  els.dialogBody.textContent = body;
  els.dialogAccept.textContent = acceptLabel;

  return new Promise((resolve) => {
    const finish = (answer) => {
      els.dialog.close();
      els.dialogAccept.removeEventListener('click', onAccept);
      els.dialogCancel.removeEventListener('click', onCancel);
      els.dialog.removeEventListener('close', onClose);
      resolve(answer);
    };
    const onAccept = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(false); // Esc, backdrop click

    els.dialogAccept.addEventListener('click', onAccept);
    els.dialogCancel.addEventListener('click', onCancel);
    els.dialog.addEventListener('close', onClose);
    els.dialog.showModal();
  });
}

async function askToDelete(habit) {
  const ok = await confirmAction({
    title: `Delete “${habit.name}”?`,
    body: 'Its history and streak go with it. This cannot be undone.',
  });
  if (!ok) return;
  state = removeHabit(state, habit.id);
  save();
  render();
}

async function askToClearAll() {
  if (state.habits.length === 0) return;
  const ok = await confirmAction({
    title: 'Delete every habit?',
    body: `${state.habits.length} habit${state.habits.length === 1 ? '' : 's'} and all their history will be removed from this browser.`,
    acceptLabel: 'Delete them all',
  });
  if (!ok) return;
  state = { version: 1, habits: [] };
  save();
  render();
}

// --- form ------------------------------------------------------------------

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = !message;
}

function onSubmit(event) {
  event.preventDefault();
  const habit = createHabit(els.name.value, els.emoji.value);
  if (!habit) {
    showError('Please give the habit a name.');
    els.name.focus();
    return;
  }
  showError('');
  state = addHabit(state, habit);
  save();
  render();

  els.form.reset();
  els.name.focus();
}

// --- wiring ----------------------------------------------------------------

function refreshDayColumns() {
  // The day grid is a function of "today". If the tab is left open overnight,
  // repaint so the columns are right.
  const fresh = recentDays(GRID_DAYS, new Date());
  if (fresh.map((d) => d.key).join() === days.map((d) => d.key).join()) return;
  days = fresh;
  render();
}

function init() {
  initTheme();
  els.form.addEventListener('submit', onSubmit);
  els.clearAll.addEventListener('click', askToClearAll);
  render();

  // Keep the grid honest if the page is left open across midnight, and when a
  // tab that was in the background comes back to the foreground.
  setInterval(refreshDayColumns, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshDayColumns();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = deserialize(event.newValue);
    render();
  });
}

init();
