/**
 * testkit.js — so the same test file runs under both runners.
 *
 * Bun has no `node:test` yet (their issue, not ours), but it does implement
 * `node:assert`. So the test body imports `assert` normally and only the
 * `test` function needs routing.
 *
 *   bun test        # Bun's runner
 *   node --test     # Node's built-in runner
 */

export const test = (typeof Bun === 'undefined' ? await import('node:test') : await import('bun:test')).test;
