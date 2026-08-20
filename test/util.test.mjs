/**
 * Fixture tests for shelf/src/util.js — TRD §16, and the acceptance check for §18 step 3.
 *
 * Run: npm test    (node --test, no dependencies)
 *
 * Lives outside shelf/ so it is never packaged into the extension.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NORMALIZE_VERSION, normalizeUrl, urlHash, domainOf, domainInitial,
  collapseWhitespace, escapeHtml,
  dayKey, dayHeading, clockTime, relativeTime, relativePhrase, fullTimestamp, toMarkdown,
} from '../shelf/src/util.js';

/* ------------------------------------------------------------------ *
 * URL normalization — the ~30 pairs TRD §18 step 3 asks for
 * ------------------------------------------------------------------ */

const URL_FIXTURES = [
  // --- scheme and host ---
  ['https://Example.COM/Path',                    'https://example.com/Path'],
  ['HTTPS://EXAMPLE.COM/x',                       'https://example.com/x'],
  ['https://www.example.com/a',                   'https://example.com/a'],
  ['https://sub.example.com/a',                   'https://sub.example.com/a'],
  ['https://example.com:443/a',                   'https://example.com/a'],
  ['http://example.com:80/a',                     'http://example.com/a'],
  ['https://example.com:8443/a',                  'https://example.com:8443/a'],

  // --- path ---
  ['https://example.com',                         'https://example.com'],
  ['http://example.com/',                         'http://example.com'],
  ['https://example.com/a/',                      'https://example.com/a'],
  ['https://example.com/a/b/',                    'https://example.com/a/b'],
  ['https://example.com/A%20B',                   'https://example.com/A%20B'],

  // --- tracking params ---
  ['https://example.com/a?utm_source=x&utm_medium=y', 'https://example.com/a'],
  ['https://example.com/a?UTM_SOURCE=x',          'https://example.com/a'],
  ['https://example.com/a?fbclid=zzz&id=7',       'https://example.com/a?id=7'],
  ['https://example.com/a?gclid=z&msclkid=y&q=1', 'https://example.com/a?q=1'],
  ['https://example.com/a?ref_src=twsrc',         'https://example.com/a'],
  ['https://example.com/a?igshid=abc&p=2',        'https://example.com/a?p=2'],
  ['https://example.com/a?mc_cid=1&mc_eid=2',     'https://example.com/a'],
  // bare `ref` is deliberately KEPT — real identifier on some sites
  ['https://example.com/a?ref=hn',                'https://example.com/a?ref=hn'],

  // --- param ordering and encoding ---
  ['https://example.com/a?b=2&a=1',               'https://example.com/a?a=1&b=2'],
  ['https://example.com/a?b=2&b=1',               'https://example.com/a?b=1&b=2'],
  ['https://example.com/a?q=hello world',         'https://example.com/a?q=hello+world'],
  ['https://example.com/?q=',                     'https://example.com?q='],

  // --- fragments ---
  ['https://example.com/a#section-2',             'https://example.com/a'],
  ['https://example.com/a#:~:text=hello',         'https://example.com/a'],
  ['https://docs.google.com/document/d/1#heading=h.abc',
   'https://docs.google.com/document/d/1#heading=h.abc'],
  ['https://groups.google.com/g/x#!topic/abc',    'https://groups.google.com/g/x#!topic/abc'],
  // text fragments dropped even on the hash-routed allowlist
  ['https://docs.google.com/d/1#:~:text=hi',      'https://docs.google.com/d/1'],

  // --- media position params (TRD §7.2) ---
  ['https://www.youtube.com/watch?v=abc&t=42s',   'https://youtube.com/watch?v=abc'],
  ['https://m.youtube.com/watch?v=abc&t=5',       'https://m.youtube.com/watch?v=abc'],
  ['https://youtu.be/abc?t=90',                   'https://youtu.be/abc'],
  ['https://www.youtube.com/watch?v=abc&si=xyz&feature=share',
   'https://youtube.com/watch?v=abc'],
  // `t` is only positional on media hosts
  ['https://example.com/a?t=42',                  'https://example.com/a?t=42'],

  // --- non-normalizable, returned untouched ---
  ['chrome://extensions',                         'chrome://extensions'],
  ['file:///Users/x/a.html',                      'file:///Users/x/a.html'],
  ['mailto:a@b.com',                              'mailto:a@b.com'],
  ['not a url',                                   'not a url'],
  ['  https://example.com/a  ',                   'https://example.com/a'],
  ['',                                            ''],
  ['   ',                                         ''],
];

test('normalizeUrl fixture table', () => {
  for (const [input, expected] of URL_FIXTURES) {
    assert.equal(normalizeUrl(input), expected, `input: ${JSON.stringify(input)}`);
  }
});

test('normalizeUrl is idempotent', () => {
  // Catches rules that fight each other — the failure mode where a URL keeps changing
  // shape each pass and its hash is never stable.
  for (const [input] of URL_FIXTURES) {
    const once = normalizeUrl(input);
    assert.equal(normalizeUrl(once), once, `not idempotent: ${JSON.stringify(input)}`);
  }
});

test('normalizeUrl never throws', () => {
  const hostile = [null, undefined, 42, {}, [], 'http://', '://x', 'https://[', '%%%',
                   'javascript:alert(1)', 'data:text/html,<b>x', 'https://' + 'a'.repeat(3000)];
  for (const input of hostile) {
    assert.doesNotThrow(() => normalizeUrl(input), `threw on ${String(input).slice(0, 40)}`);
    assert.equal(typeof normalizeUrl(input), 'string');
  }
});

test('NORMALIZE_VERSION is a positive integer', () => {
  assert.ok(Number.isInteger(NORMALIZE_VERSION) && NORMALIZE_VERSION > 0);
});

/* ------------------------------------------------------------------ *
 * urlHash
 * ------------------------------------------------------------------ */

test('urlHash is 32 lowercase hex chars', async () => {
  const h = await urlHash('https://example.com/a');
  assert.match(h, /^[0-9a-f]{32}$/);
});

test('urlHash is deterministic and distinguishes inputs', async () => {
  const a1 = await urlHash('https://example.com/a');
  const a2 = await urlHash('https://example.com/a');
  const b = await urlHash('https://example.com/b');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
});

test('urlHash groups clips that normalize together', async () => {
  // The property the whole scheme exists for: same page, different tracking junk,
  // same hash — so "3 clips from this page" is answerable.
  const a = await urlHash(normalizeUrl('https://www.example.com/post?utm_source=twitter'));
  const b = await urlHash(normalizeUrl('https://example.com/post/#intro'));
  assert.equal(a, b);
});

/* ------------------------------------------------------------------ *
 * domain
 * ------------------------------------------------------------------ */

test('domainOf', () => {
  assert.equal(domainOf('https://www.aeon.co/essays/x'), 'aeon.co');
  assert.equal(domainOf('https://notes.andymatuschak.org/a'), 'notes.andymatuschak.org');
  assert.equal(domainOf('not a url'), '');
  assert.equal(domainOf(''), '');
});

test('domainInitial', () => {
  assert.equal(domainInitial('aeon.co'), 'a');
  assert.equal(domainInitial('GitHub.com'), 'g');
  assert.equal(domainInitial(''), '·');       // never blank — the avatar always renders
  assert.equal(domainInitial(null), '·');
});

/* ------------------------------------------------------------------ *
 * text
 * ------------------------------------------------------------------ */

test('collapseWhitespace', () => {
  assert.equal(collapseWhitespace('  a   b  '), 'a b');
  assert.equal(collapseWhitespace('a\n\nb\tc'), 'a b c');
  assert.equal(collapseWhitespace('a b'), 'a b');   // non-breaking space
  assert.equal(collapseWhitespace(''), '');
  assert.equal(collapseWhitespace(null), '');
});

test('escapeHtml neutralises a script break-out', () => {
  // TRD §12's named hazard: this string must not be able to close the tag it sits in.
  const hostile = '</script><img src=x onerror=alert(1)>';
  const escaped = escapeHtml(hostile);
  assert.ok(!escaped.includes('<'));
  assert.ok(!escaped.includes('>'));
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('"q"'), '&quot;q&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml(null), '');
});

test('escapeHtml escapes the ampersand first', () => {
  // Getting the order wrong yields &amp;lt; — a classic double-escape bug.
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

/* ------------------------------------------------------------------ *
 * time — timestamps built from LOCAL components so these pass in any zone
 * ------------------------------------------------------------------ */

const AUG20 = new Date(2026, 7, 20, 9, 12, 34).getTime();   // Thu 20 Aug 2026, 09:12:34

test('dayKey', () => {
  assert.equal(dayKey(AUG20), '2026-08-20');
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
});

test('dayHeading', () => {
  assert.deepEqual(dayHeading(AUG20), { weekday: 'Thursday', date: '20 August 2026' });
});

test('clockTime', () => {
  assert.equal(clockTime(AUG20), '9:12 AM');
  assert.equal(clockTime(new Date(2026, 7, 20, 0, 5).getTime()), '12:05 AM');   // midnight
  assert.equal(clockTime(new Date(2026, 7, 20, 12, 0).getTime()), '12:00 PM');  // noon
  assert.equal(clockTime(new Date(2026, 7, 20, 22, 5).getTime()), '10:05 PM');
});

test('relativeTime ladder', () => {
  const now = AUG20;
  assert.equal(relativeTime(now, now), 'just now');
  assert.equal(relativeTime(now - 30 * 1000, now), 'just now');
  assert.equal(relativeTime(now - 5 * 60 * 1000, now), '5m');
  assert.equal(relativeTime(now - 59 * 60 * 1000, now), '59m');
  assert.equal(relativeTime(now - 2 * 3600 * 1000, now), '2h');
  assert.equal(relativeTime(now - 23 * 3600 * 1000, now), '23h');
  assert.equal(relativeTime(now - 26 * 3600 * 1000, now), '19 Aug');
});

test('relativeTime shows the year once it is a different one', () => {
  const now = new Date(2027, 0, 10, 12, 0).getTime();
  const old = new Date(2026, 7, 20, 12, 0).getTime();
  assert.equal(relativeTime(old, now), '20 Aug 2026');
});

test('relativeTime never shows a future age', () => {
  // Clock skew, or a backup restored from a machine running ahead.
  assert.equal(relativeTime(AUG20 + 60_000, AUG20), 'just now');
});

test('fullTimestamp answers "when did I read this"', () => {
  assert.equal(fullTimestamp(AUG20), 'Thursday, 20 August 2026 at 9:12 AM:34');
});

test('relativePhrase reads correctly at every rung of the ladder', () => {
  // relativeTime returns three different shapes and only one of them takes " ago".
  // Appending it unconditionally gave "just now ago" and "19 Aug ago" in the backup
  // footer — grammatically wrong in two cases out of three, and invisible to any test
  // that only checked relativeTime itself.
  const now = new Date(2026, 7, 20, 9, 12, 34).getTime();
  assert.equal(relativePhrase(now, now), 'just now');
  assert.equal(relativePhrase(now - 30_000, now), 'just now');
  assert.equal(relativePhrase(now - 5 * 60_000, now), '5m ago');
  assert.equal(relativePhrase(now - 2 * 3600_000, now), '2h ago');
  assert.equal(relativePhrase(now - 26 * 3600_000, now), 'on 19 Aug');
});

test('relativePhrase never produces a double time-word', () => {
  const now = new Date(2026, 7, 20, 12, 0).getTime();
  for (const offset of [0, 1e3, 6e4, 36e5, 9e7, 4e10]) {
    const phrase = relativePhrase(now - offset, now);
    assert.doesNotMatch(phrase, /now ago|Aug ago|Jan ago/, `bad phrase: "${phrase}"`);
  }
});

/* ------------------------------------------------------------------ *
 * toMarkdown — PRD U13
 * ------------------------------------------------------------------ */

const mdClip = (over = {}) => ({
  text: 'A collection is not a hoard.',
  title: 'What we owe',
  url: 'https://aeon.co/essays/x',
  domain: 'aeon.co',
  note: '',
  savedAt: new Date(2026, 7, 20, 9, 12).getTime(),
  ...over,
});

test('a passage becomes a blockquote with a citation', () => {
  const md = toMarkdown(mdClip());
  assert.match(md, /^> A collection is not a hoard\.$/m);
  assert.match(md, /— \[What we owe\]\(https:\/\/aeon\.co\/essays\/x\), 20 August 2026/);
});

test('a page-save is not quoted', () => {
  // Quoting a title the user never selected would misrepresent what was saved.
  const md = toMarkdown(mdClip({ text: '' }));
  assert.doesNotMatch(md, /^>/m);
  assert.match(md, /^— \[What we owe\]/m);
});

test('a multi-line passage stays inside one blockquote', () => {
  // Without prefixing every line, the quote breaks out halfway and the rest of the
  // passage renders as body text.
  const md = toMarkdown(mdClip({ text: 'first line\nsecond line' }));
  assert.match(md, /^> first line$/m);
  assert.match(md, /^> second line$/m);
});

test('brackets in a title cannot break the link', () => {
  const md = toMarkdown(mdClip({ title: 'Notes [draft] (v2)' }));
  assert.match(md, /\[Notes \\\[draft\\\] \(v2\)\]/);
  assert.match(md, /\]\(https:\/\/aeon\.co/, 'the url must still be the link target');
});

test('a note is appended in italics', () => {
  assert.match(toMarkdown(mdClip({ note: 'why it mattered' })), /\*why it mattered\*/);
});

test('toMarkdown never emits undefined for a sparse clip', () => {
  const md = toMarkdown({ text: 'x', savedAt: 0 });
  assert.doesNotMatch(md, /undefined|null|NaN/);
});

test('toMarkdown falls back to the domain when there is no title', () => {
  const md = toMarkdown(mdClip({ title: '' }));
  assert.match(md, /\[aeon\.co\]/);
});
