/**
 * Design-token drift guard.
 *
 * The canvas at design/Shelf Library.dc.html is the design of record. Shipped code
 * hardcodes a few of its colours (the save bar and the toolbar badge live outside any
 * stylesheet — the bar is in a closed shadow root, the badge is a chrome.action call),
 * so a palette change in the canvas cannot propagate on its own.
 *
 * This test reads the accent straight out of the canvas and asserts the code agrees.
 * Without it, "the design changed" silently means "the design changed everywhere except
 * the two surfaces the user actually touches while saving".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const CANVAS = 'design/Shelf Library.dc.html';

/** Pull `--name:#RRGGBB` out of the canvas, for a given :root or [data-theme] block. */
function tokens(scope) {
  const css = readFileSync(CANVAS, 'utf8');
  const block = css.match(new RegExp(scope + '\\s*\\{([^}]*)\\}'));
  assert.ok(block, `no ${scope} block in ${CANVAS}`);
  return Object.fromEntries(
    [...block[1].matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)].map(([, k, v]) => [k, v.toUpperCase()])
  );
}

const EXT = 'shelf';

/** Every shipped file that can name a typeface. */
function assetFiles(dir = EXT) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return assetFiles(p);
    return ['.js', '.css', '.html'].includes(extname(p)) ? [p] : [];
  });
}

function sourceFiles(dir = 'shelf/src') {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : extname(p) === '.js' ? [p] : [];
  });
}

const light = tokens(':root');
const dark = tokens('\\[data-theme="dark"\\]');

test('canvas still defines the tokens the code depends on', () => {
  for (const key of ['accent', 'accent-soft', 'ink', 'paper', 'warn']) {
    assert.match(light[key] ?? '', /^#[0-9A-F]{6}$/, `light --${key}`);
  }
  assert.match(dark.accent ?? '', /^#[0-9A-F]{6}$/, 'dark --accent');
});

test('shipped code uses the canvas accent, not a stale one', () => {
  const code = sourceFiles().map((f) => readFileSync(f, 'utf8').toUpperCase()).join('\n');
  assert.ok(code.includes(light.accent), `light accent ${light.accent} missing from source`);
  assert.ok(code.includes(dark.accent), `dark accent ${dark.accent} missing from source`);
});

test('no colour from a previous palette lingers in the source', () => {
  // Every 6-digit hex in the source must be a current token, or an explicitly derived
  // shade listed here with its reason. Anything else is drift.
  const DERIVED = {
    '#8E3A22': 'save-button hover. Darker than --accent because lightening a mid-tone '
             + 'terracotta drops paper-on-accent to 4.33:1 and fails WCAG AA.',
  };
  const allowed = new Set([
    ...Object.values(light), ...Object.values(dark), ...Object.keys(DERIVED),
  ]);

  const stale = new Set();
  for (const file of sourceFiles()) {
    for (const [hex] of readFileSync(file, 'utf8').matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
      if (!allowed.has(hex.toUpperCase())) stale.add(`${hex} in ${file}`);
    }
  }
  assert.deepEqual([...stale], [], 'colours not traceable to the design canvas');
});

/* ---------------------------------------------------------------- typography */

/** The families the canvas actually uses, from its --sans/--serif tokens. */
function canvasFamilies() {
  const css = readFileSync(CANVAS, 'utf8');
  return [...css.matchAll(/--(sans|serif)\s*:\s*([^;]+);/g)]
    .map(([, role, value]) => [role, value.trim()]);
}

test('the canvas declares a sans and no serif', () => {
  // The revised canvas dropped the serif entirely. If one ever returns, this fails and
  // the shipped CSS gets updated deliberately rather than drifting apart from the design.
  const roles = Object.fromEntries(canvasFamilies());
  assert.ok(roles.sans, 'canvas must define --sans');
  assert.equal(roles.serif, undefined, 'canvas defines a --serif again; ship one too');
});

test('no shipped file references a retired typeface', () => {
  // Lora and Karla were removed with the font change. A leftover reference does not
  // error — it silently falls back to Georgia or system-ui, so one surface renders in a
  // different face and nobody notices until a screenshot.
  const RETIRED = /\bLora\b|\bKarla\b|var\(--serif\)/;
  for (const file of assetFiles()) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), RETIRED, `retired typeface in ${file}`);
  }
});

test('every bundled font file is referenced, and every reference exists', () => {
  // Catches both halves: a font removed from CSS but left in the bundle (dead weight in
  // a store submission) and a font referenced but not shipped (a silent fallback).
  const dir = join(EXT, 'fonts');
  const css = readFileSync(join(dir, 'fonts.css'), 'utf8');
  const referenced = new Set([...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]));
  const present = new Set(readdirSync(dir).filter((f) => f.endsWith('.woff2')));

  assert.deepEqual([...referenced].filter((f) => !present.has(f)), [], 'referenced but missing');
  assert.deepEqual([...present].filter((f) => !referenced.has(f)), [], 'shipped but unreferenced');
});

test('the shipped font family matches the canvas', () => {
  const roles = Object.fromEntries(canvasFamilies());
  const family = roles.sans.match(/'([^']+)'|^([\w ]+)/)?.[1] ?? '';
  const theme = readFileSync(join(EXT, 'src', 'theme.css'), 'utf8');
  assert.ok(theme.includes(family), `theme.css should use ${family}`);
  const fontsCss = readFileSync(join(EXT, 'fonts', 'fonts.css'), 'utf8');
  assert.ok(fontsCss.includes(family), `fonts.css should bundle ${family}`);
});
