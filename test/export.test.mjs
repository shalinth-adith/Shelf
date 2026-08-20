/**
 * Static HTML export — TRD §12, PRD §8.4.
 *
 * The step-7 acceptance check is "zero network requests; identical input -> identical
 * bytes". Both are asserted here rather than eyeballed, because both fail silently: a
 * remote font still renders, and a drifting byte only shows up as a noisy diff months
 * later.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportHtml, domainTally } from '../shelf/src/export.js';

const clip = (over = {}) => ({
  id: 'id-1',
  text: 'A collection is not a hoard.',
  note: '',
  color: 'yellow',
  url: 'https://aeon.co/essays/x',
  canonicalUrl: 'https://aeon.co/essays/x',
  urlHash: 'deadbeef'.repeat(4),
  normalizeVersion: 1,
  domain: 'aeon.co',
  title: 'What we owe',
  context: { prefix: 'SECRET_PREFIX', suffix: 'SECRET_SUFFIX' },
  seconds: null,
  savedAt: 1_787_000_000_000,
  isPublic: true,
  ...over,
});

/* ---------------------------------------------------------------- determinism */

test('identical input produces byte-identical output', () => {
  const clips = [clip(), clip({ id: 'id-2', savedAt: 1_787_000_001_000 })];
  assert.equal(buildExportHtml(clips), buildExportHtml(clips));
});

test('input order does not affect output', () => {
  // Guards the real-world case: IndexedDB returns rows in whatever order it likes, and
  // that must not leak into a file people commit to a repo.
  const a = clip({ id: 'a', savedAt: 1 });
  const b = clip({ id: 'b', savedAt: 2 });
  const c = clip({ id: 'c', savedAt: 3 });
  assert.equal(buildExportHtml([a, b, c]), buildExportHtml([c, a, b]));
});

test('clips with identical timestamps still sort stably', () => {
  const a = clip({ id: 'aaa', savedAt: 5 });
  const b = clip({ id: 'bbb', savedAt: 5 });
  assert.equal(buildExportHtml([a, b]), buildExportHtml([b, a]));
});

test('output contains no timestamp of its own', () => {
  // A generatedAt would defeat determinism entirely. Git already knows when the file
  // was written.
  const html = buildExportHtml([clip()]);
  assert.doesNotMatch(html, /generatedAt|generated_at/i);
});

/* ---------------------------------------------------------------- zero network */

test('the exported file references no remote origin', () => {
  const html = buildExportHtml([clip()]);
  const hits = [...html.matchAll(/https?:\/\/[^\s'"<>)]+/g)]
    .map((m) => m[0])
    .filter((u) => !u.startsWith('https://aeon.co'));   // the clip's own link
  assert.deepEqual(hits, [], 'remote origin in export');
});

test('the exported file contains no network primitive', () => {
  const html = buildExportHtml([clip()]);
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
});

test('the exported file pins its own CSP to default-src none', () => {
  // Belt and braces: even edited later, the file cannot open a connection.
  assert.match(buildExportHtml([clip()]), /default-src 'none'/);
});

/* ---------------------------------------------------------------- escaping */

test('a clip containing </script> cannot break out of the payload', () => {
  // TRD §12's named hazard, and a matter of when rather than if — any clip taken from an
  // article about writing HTML will contain this.
  const hostile = clip({ text: 'Close it with </script><img src=x onerror=alert(1)>' });
  const html = buildExportHtml([hostile]);

  const payload = html.slice(html.indexOf('id="shelf-data"'));
  const body = payload.slice(payload.indexOf('>') + 1, payload.indexOf('</script>'));
  assert.doesNotMatch(body, /<\/script/i, 'payload closed its own tag');
  assert.ok(body.includes('\\u003c'), 'expected < to be escaped');
  assert.deepEqual(JSON.parse(body)[0].text, hostile.text, 'escaping must be lossless');
});

test('a hostile title cannot inject markup into the header', () => {
  const html = buildExportHtml([clip()], { title: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

/* ---------------------------------------------------------------- privacy */

test('captured page context never leaves the machine', () => {
  // TRD §6 stores 32 chars either side of the selection as a hedge for a feature that
  // does not exist. The user never chose to save that text. Publishing it would publish
  // words they did not select, from pages they were reading.
  const html = buildExportHtml([clip()]);
  assert.doesNotMatch(html, /SECRET_PREFIX|SECRET_SUFFIX/);
  assert.doesNotMatch(html, /"context"/);
});

test('internal plumbing is not published', () => {
  const html = buildExportHtml([clip()]);
  for (const field of ['urlHash', 'canonicalUrl', 'normalizeVersion', 'isPublic', 'color']) {
    assert.ok(!html.includes(`"${field}"`), `${field} leaked into the export`);
  }
});

test('only the intended fields ship, in a fixed key order', () => {
  const html = buildExportHtml([clip()]);
  const payload = html.slice(html.indexOf('id="shelf-data"'));
  const body = payload.slice(payload.indexOf('>') + 1, payload.indexOf('</script>'));
  const record = JSON.parse(body.replace(/\\u003c/g, '<'))[0];
  assert.deepEqual(Object.keys(record),
    ['id', 'savedAt', 'domain', 'title', 'url', 'text', 'note']);
});

/* ---------------------------------------------------------------- tally */

test('domainTally counts and orders by frequency', () => {
  const clips = [
    clip({ domain: 'aeon.co' }), clip({ domain: 'aeon.co' }),
    clip({ domain: 'github.com' }),
  ];
  assert.deepEqual(domainTally(clips), [['aeon.co', 2], ['github.com', 1]]);
});

test('domainTally never shows a blank site', () => {
  assert.deepEqual(domainTally([clip({ domain: '' })]), [['local', 1]]);
});

/* ---------------------------------------------------------------- shape */

test('an empty export is still a valid document', () => {
  const html = buildExportHtml([]);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /0 passages from 0 sites/);
});

/** The JSON payload, decoded. */
function payloadOf(html) {
  const tail = html.slice(html.indexOf('id="shelf-data"'));
  const body = tail.slice(tail.indexOf('>') + 1, tail.indexOf('</script>'));
  return JSON.parse(body.replace(/\\u003c/g, '<'));
}

test('a missing note or title becomes an empty string, never undefined', () => {
  // Scoped to the payload, not the whole document — the bundled filter script legitimately
  // contains the token `undefined` in `if (x !== undefined)`, and matching against the
  // full file catches that instead of the thing under test.
  const record = payloadOf(buildExportHtml([clip({ note: undefined, title: undefined })]))[0];
  assert.equal(record.note, '');
  assert.equal(record.title, '');
  for (const value of Object.values(record)) {
    assert.notEqual(value, undefined);
    assert.notEqual(value, null);
  }
});

test('a clip missing savedAt does not sort as NaN', () => {
  // NaN comparisons are always false, so a single bad record would silently randomise
  // ordering and break determinism for the whole file.
  const html = buildExportHtml([clip({ id: 'a', savedAt: undefined }), clip({ id: 'b' })]);
  assert.equal(html, buildExportHtml([clip({ id: 'b' }), clip({ id: 'a', savedAt: undefined })]));
});

test('the static header and the runtime header agree', () => {
  // They are two separate pieces of code writing the same element — the static one for
  // anyone with JS disabled, the runtime one on every keystroke. When they disagree the
  // header changes shape the instant the page renders, and nobody sees the first version
  // long enough to notice it was different.
  const html = buildExportHtml([clip({ id: 'a' }), clip({ id: 'b', domain: 'github.com' })]);

  const staticText = html.match(/id="count">([^<]+)</)[1];
  assert.match(staticText, /2 passages from 2 sites/);

  // the runtime script must build the same shape: "<n> passages from <n> sites"
  assert.match(html, /' from '\+nd\+\(nd===1\?' site':' sites'\)/,
    'runtime count must include the site tally');
});

test('the header does not repeat itself', () => {
  const html = buildExportHtml([clip()]);
  const line = html.match(/<p class="sub">(.*?)<\/p>/s)[1];
  const passages = (line.match(/passage/g) || []).length;
  assert.equal(passages, 1, `"passage" appears ${passages} times in the header line`);
});
