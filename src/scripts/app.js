/**
 * app.js — the only client entry point.
 *
 * All wiring, all DOM. It never does date or streak arithmetic itself; it
 * asks logic.js and paints the answer. Persistence goes through storage.js.
 */

import {
  GRID_DAYS,
  addHabit,
  createHabit,
  currentStreak,
  findHabit,
  isDone,
  recentDays,
  removeHabit,
  toggleDay,
  updateHabit,
} from '../lib/logic.js';

import {
  THEMES,
  isEphemeral,
  loadState,
  loadTheme,
  saveState,
  saveTheme,
} from '../lib/storage.js';

const el = (id) => document.getElementById(id);

const dom = {
  form: el('add-habit-form'),
  name: el('habit-name'),
  emoji: el('habit-emoji'),
  error: el('form-error'),
  storageWarning: el('storage-warning'),
  list: el('habits'),
  empty: el('empty-state'),
  summary: el('summary'),
  clearAll: el('clear-all'),
  habitTemplate: el('habit-template'),
  dayTemplate: el('day-template'),
  dialog: el('confirm-dialog'),
  dialogTitle: el('confirm-title'),
  dialogBody: el('confirm-body'),
  dialogAccept: el('confirm-accept'),
  dialogCancel: el('confirm-cancel'),
  themeButtons: [...document.querySelectorAll('[data-theme-choice]')],
};

let state = loadState();
let days = recentDays(GRID_DAYS, new Date());

// --- persistence ------------------------------------------------------------

/** Save, and say so out loud if the browser refused. */
function persist() {
  if (isEphemeral) {
    dom.storageWarning.hidden = false;
    return;
  }
  if (!saveState(state)) dom.storageWarning.hidden = false;
}

// --- theme ------------------------------------------------------------------

function applyTheme(theme) {
  const choice = THEMES.includes(theme) ? theme : 'auto';
  document.documentElement.dataset.theme = choice;
  for (const button of dom.themeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
  }
  saveTheme(choice);
}

// --- rendering --------------------------------------------------------------

/**
 * Paint a habit card. Reused wholesale when a day is toggled, so the click
 * handler below can swap one card without re-rendering the list.
 */
function renderHabit(habit) {
  const card = dom.habitTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.habitId = habit.id;

  const streak = currentStreak(habit, new Date());
  card.querySelector('[data-role="emoji"]').textContent = habit.emoji;
  card.querySelector('[data-role="name"]').textContent = habit.name;
  card.querySelector('[data-role="streak-count"]').textContent = String(streak);

  const badge = card.querySelector('[data-role="streak"]');
  badge.dataset.hot = String(streak >= 3);

  card.querySelector('[data-role="delete"]').addEventListener('click', () => askToDelete(habit));

  const week = card.querySelector('.week');
  for (const day of days) week.append(renderDay(habit, day));
  return card;
}

function renderDay(habit, day) {
  const cell = dom.dayTemplate.content.firstElementChild.cloneNode(true);
  const done = isDone(habit, day.key);
  cell.classList.toggle('day-done', done);
  cell.classList.toggle('day-today', day.isToday);

  const button = cell.querySelector('button');
  button.querySelector('.day-weekday').textContent = day.weekday;
  button.querySelector('.day-number').textContent = String(day.dayOfMonth);
  button.setAttribute('aria-pressed', String(done));
  button.setAttribute(
    'aria-label',
    `${habit.name} on ${day.key}${done ? ' — done, tap to undo' : ' — not done, tap to mark done'}`,
  );

  button.addEventListener('click', () => {
    const current = findHabit(state, habit.id);
    if (!current) return;
    state = updateHabit(state, toggleDay(current, day.key));
    persist();

    // Swap just this card. The day cell is a plain <li>, so climb to the
    // card that owns it before replacing anything.
    const card = cell.closest('.habit');
    if (card) card.replaceWith(renderHabit(findHabit(state, habit.id)));
    renderSummary(state.habits);
  });

  return cell;
}

function render() {
  // Insertion order, deliberately: a list that reshuffles itself every time you
  // tick a day is maddening to use.
  dom.list.replaceChildren(...state.habits.map(renderHabit));
  dom.empty.hidden = state.habits.length > 0;
  renderSummary(state.habits);
}

function renderSummary(habits) {
  if (habits.length === 0) {
    dom.summary.textContent = 'No habits saved yet.';
    return;
  }
  const ticked = habits.reduce(
    (sum, habit) => sum + days.filter((day) => isDone(habit, day.key)).length,
    0,
  );
  const best = habits.reduce((max, habit) => Math.max(max, currentStreak(habit)), 0);
  dom.summary.textContent =
    `${habits.length} habit${habits.length === 1 ? '' : 's'} · ` +
    `${ticked} tick${ticked === 1 ? '' : 's'} this week · ` +
    `best streak ${best}`;
}

// --- confirmation -----------------------------------------------------------

/** Wrap the native <dialog> in a promise so callers can just await it. */
function confirmAction({ title, body, acceptLabel = 'Delete' }) {
  dom.dialogTitle.textContent = title;
  dom.dialogBody.textContent = body;
  dom.dialogAccept.textContent = acceptLabel;

  return new Promise((resolve) => {
    const done = (answer) => {
      dom.dialog.close();
      dom.dialogAccept.removeEventListener('click', onAccept);
      dom.dialogCancel.removeEventListener('click', onCancel);
      dom.dialog.removeEventListener('close', onClose);
      resolve(answer);
    };
    const onAccept = () => done(true);
    const onCancel = () => done(false);
    const onClose = () => done(false); // Esc or a backdrop click

    dom.dialogAccept.addEventListener('click', onAccept);
    dom.dialogCancel.addEventListener('click', onCancel);
    dom.dialog.addEventListener('close', onClose);
    dom.dialog.showModal();
  });
}

async function askToDelete(habit) {
  const ok = await confirmAction({
    title: `Delete “${habit.name}”?`,
    body: 'Its history and streak go with it. This cannot be undone.',
  });
  if (!ok) return;
  state = removeHabit(state, habit.id);
  persist();
  render();
}

async function askToClearAll() {
  const count = state.habits.length;
  if (count === 0) return;
  const ok = await confirmAction({
    title: 'Delete every habit?',
    body: `${count} habit${count === 1 ? '' : 's'} and all their history will be removed from this browser.`,
    acceptLabel: 'Delete them all',
  });
  if (!ok) return;
  state = { version: 1, habits: [] };
  persist();
  render();
}

// --- events -----------------------------------------------------------------

function showError(message) {
  dom.error.textContent = message;
  dom.error.hidden = !message;
}

function onSubmit(event) {
  event.preventDefault();
  const habit = createHabit(dom.name.value, dom.emoji.value);
  if (!habit) {
    showError('Please give the habit a name.');
    dom.name.focus();
    return;
  }
  showError('');
  state = addHabit(state, habit);
  persist();
  render();
  dom.form.reset();
  dom.name.focus();
}

/** The grid is a function of "today"; repaint if that function changed. */
function refreshDayColumns() {
  const fresh = recentDays(GRID_DAYS, new Date());
  if (fresh.map((d) => d.key).join() === days.map((d) => d.key).join()) return;
  days = fresh;
  render();
}

/**
 * Put the assets this page just loaded into the service worker's cache.
 *
 * On a first visit the CSS and JS are fetched *before* the worker exists, so
 * the worker never sees them and they would only be cached on the second
 * visit. Re-fetching them here (the browser answers from its own HTTP cache,
 * so it is nearly free) makes the app genuinely usable offline straight away,
 * without the rude page reload that a `controllerchange` handler would cause.
 */
async function warmCache() {
  if (!('caches' in window)) return;
  const names = await caches.keys();
  const name = names.find((entry) => entry.startsWith('habit-tracker-'));
  if (!name) return;

  const urls = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => url.startsWith(location.origin));

  const cache = await caches.open(name);
  await Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Only over http(s), and only in production: dev reloads are not worth caching.
  if (import.meta.env.DEV) return;

  const register = () => {
    // BASE_URL has no trailing slash in Astro. A scope must be a prefix of the
    // script's own directory, so `/habit-tracker` (which would also cover
    // `/habit-tracker-anything`) is rejected without the slash.
    const base = import.meta.env.BASE_URL;
    const dir = base.endsWith('/') ? base : `${base}/`;
    navigator.serviceWorker
      .register(`${dir}sw.js`, { scope: dir })
      .then(() => navigator.serviceWorker.ready)
      .then(warmCache)
      .catch((error) => console.warn('Service worker registration failed.', error));
  };

  // Waiting for `load` is politer, but the event may already have fired by the
  // time this module runs — in which case nothing would ever register.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

function init() {
  applyTheme(loadTheme());
  for (const button of dom.themeButtons) {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
  }

  dom.form.addEventListener('submit', onSubmit);
  dom.clearAll.addEventListener('click', askToClearAll);
  render();

  // Midnight roll-over, a tab returning to the foreground, and changes made in
  // another tab of the same browser.
  setInterval(refreshDayColumns, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshDayColumns();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== 'habit-tracker:v1') return;
    state = loadState();
    render();
  });

  registerServiceWorker();
}

init();
