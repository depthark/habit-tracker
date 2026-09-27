/**
 * storage.js — the only module in the app that touches `localStorage`.
 *
 * logic.js stays pure; this is the thin, defensive layer that binds it to the
 * browser. Every operation is failure-tolerant: a blocked, full or absent
 * storage degrades to an in-memory store rather than breaking the page.
 */

import { STORAGE_KEY, deserialize, emptyState, serialize } from './logic.js';

const THEME_KEY = 'habit-tracker:theme';
const THEMES = ['light', 'auto', 'dark'];

/** A Map-backed stand-in used when localStorage is unavailable. */
function memoryBackend() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    __memory: true,
  };
}

function pickBackend() {
  try {
    const probe = '__habit_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return memoryBackend();
  }
}

const backend = pickBackend();

/** True when habits will not survive a reload. */
export const isEphemeral = Boolean(backend.__memory);

/**
 * Read saved state. Corrupt or missing data yields an empty state.
 * @returns {{version:number, habits:Array}}
 */
export function loadState() {
  try {
    return deserialize(backend.getItem(STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

/**
 * Persist state. Returns false when the write was refused, so the UI can say so.
 * @returns {boolean} whether the data was actually saved
 */
export function saveState(state) {
  try {
    backend.setItem(STORAGE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

/** Wipe everything this app has stored. */
export function clearAll() {
  try {
    backend.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Read the saved theme preference; 'auto' unless told otherwise. */
export function loadTheme() {
  try {
    const saved = backend.getItem(THEME_KEY);
    return THEMES.includes(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTheme(theme) {
  try {
    backend.setItem(THEME_KEY, THEMES.includes(theme) ? theme : 'auto');
    return true;
  } catch {
    return false;
  }
}

export { THEMES };
