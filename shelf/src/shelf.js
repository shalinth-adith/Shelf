/**
 * Shelf — the library page.
 *
 * Reads IndexedDB directly (TRD §4); only writes that create clips go through the
 * worker. Note edits and deletes are written from here, because they originate here and
 * a round trip would buy nothing.
 *
 * Rendering is plain DOM construction, never innerHTML. Every string on this page came
 * off a web page — passage text, titles, domains — and building nodes means there is no
 * escaping step to forget. It also happens to be what makes search highlighting simple.
 */

import * as db from './db.js';
import {
  dayKey, dayHeading, clockTime, relativeTime, fullTimestamp,
  domainInitial, collapseWhitespace,
} from './util.js';

const log = (...a) => console.debug('[shelf:page]', ...a);

/** How long a deleted clip can be restored. D6. */
const UNDO_MS = 8000;

const state = {
  clips: [],
  query: '',
  from: '',
  to: '',
  sort: 'newest',
  selected: new Set(),
};

/** The pending undo, if any. Holds the record itself — the DB no longer has it. */
let pendingUndo = null;
let undoTimer = 0;

const $ = (id) => document.getElementById(id);

/* ================================================================== *
 * Filtering — TRD §11
 *
 * Linear scan, AND-matching lowercase tokens. No index. At ~500 bytes per clip (D2
 * keeps it there) 5,000 clips is a couple of megabytes in memory and filters well
 * inside the 20ms budget. MiniSearch only if measurement says otherwise.
 * ================================================================== */

function tokens(query) {
  return collapseWhitespace(query).toLowerCase().split(' ').filter(Boolean);
}

function haystack(clip) {
  return (clip.text + ' ' + clip.note + ' ' + clip.title + ' ' + clip.domain).toLowerCase();
}

function filtered() {
  const terms = tokens(state.query);
  const out = state.clips.filter((clip) => {
    if (terms.length) {
      const hay = haystack(clip);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (state.from || state.to) {
      const day = dayKey(clip.savedAt);
      if (state.from && day < state.from) return false;
      if (state.to && day > state.to) return false;
    }
    return true;
  });

  if (state.sort === 'title') {
    // Sort on what the row actually leads with, not always the title — otherwise the
    // list appears unsorted to anyone reading it. See leadText().
    out.sort((a, b) => leadText(a).localeCompare(leadText(b)));
  } else if (state.sort === 'oldest') {
    out.sort((a, b) => a.savedAt - b.savedAt);
  } else {
    out.sort((a, b) => b.savedAt - a.savedAt);
  }
  return out;
}

/* ================================================================== *
 * D3 — what leads the row
 *
 * A clip with a selected passage leads with the passage; a page-save leads with its
 * title. Reconciles PRD §8.2 ("a list of sentences, not a list of links") with a canvas
 * drawn title-first. Both render at the same size and weight, so the row's rhythm is
 * identical either way and the list never looks ragged.
 * ================================================================== */

function hasPassage(clip) {
  return Boolean(clip.text && clip.text.trim());
}

function leadText(clip) {
  return hasPassage(clip) ? clip.text : (clip.title || clip.domain || clip.url);
}

/* ================================================================== *
 * Rendering
 * ================================================================== */

/**
 * Text with search terms wrapped in <mark>, as a fragment.
 *
 * Built from nodes rather than an escaped HTML string. The input is page-derived, and
 * the version of this that interpolates into innerHTML is a cross-site scripting hole
 * on a page that can read the entire library.
 */
function marked(text, terms) {
  const frag = document.createDocumentFragment();
  if (!terms.length) {
    frag.append(document.createTextNode(text));
    return frag;
  }

  const lower = text.toLowerCase();
  // Collect every match span, then merge overlaps so two terms hitting the same
  // characters produce one mark rather than nested ones.
  const spans = [];
  for (const term of terms) {
    let i = lower.indexOf(term);
    while (i !== -1) {
      spans.push([i, i + term.length]);
      i = lower.indexOf(term, i + term.length);
    }
  }
  if (!spans.length) {
    frag.append(document.createTextNode(text));
    return frag;
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) frag.append(document.createTextNode(text.slice(cursor, s)));
    const m = document.createElement('mark');
    m.textContent = text.slice(s, e);
    frag.append(m);
    cursor = e;
  }
  if (cursor < text.length) frag.append(document.createTextNode(text.slice(cursor)));
  return frag;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Relative under a day, clock time beyond — the day heading already carries the date. */
function timeLabel(savedAt, now) {
  return now - savedAt < 86400000 ? relativeTime(savedAt, now) : clockTime(savedAt);
}

function renderClip(clip, terms, now) {
  const row = el('article', 'clip');
  row.dataset.id = clip.id;
  row.dataset.selected = state.selected.has(clip.id) ? 'true' : 'false';

  // -- select
  const check = el('button', 'check', state.selected.has(clip.id) ? '✓' : '');
  check.type = 'button';
  check.title = 'Select';
  check.setAttribute('aria-pressed', String(state.selected.has(clip.id)));
  check.addEventListener('click', () => toggleSelect(clip.id));
  row.append(check);

  // -- body
  const body = el('div', 'body');

  const meta = el('div', 'meta');
  meta.append(el('span', 'avatar', domainInitial(clip.domain)));
  const dom = el('span', 'dom');
  dom.append(marked(clip.domain || 'local', terms));
  meta.append(dom, el('span', null, '·'));
  const time = el('span', null, timeLabel(clip.savedAt, now));
  time.title = fullTimestamp(clip.savedAt);   // "when did I read this" always answerable
  meta.append(time);
  body.append(meta);

  // -- the lead (D3)
  const lead = el('a', hasPassage(clip) ? 'lead passage' : 'lead');
  lead.href = clip.url;
  lead.target = '_blank';
  lead.rel = 'noreferrer';                    // no referrer leaves this machine
  lead.append(marked(leadText(clip), terms));
  body.append(lead);

  // When the passage leads, the title still has to be reachable — demoted, not dropped.
  if (hasPassage(clip) && clip.title) {
    const sub = el('a', 'subtitle');
    sub.href = clip.url;
    sub.target = '_blank';
    sub.rel = 'noreferrer';
    sub.append(marked(clip.title, terms));
    body.append(sub);
  }

  // -- note
  if (clip.note) {
    const note = el('div', 'note');
    note.append(el('span', 'note-label', 'Note'));
    const text = el('span', 'note-text');
    text.append(marked(clip.note, terms));
    text.title = 'Click to edit';
    text.addEventListener('click', () => editNote(row, clip));
    note.append(text);
    body.append(note);
  }

  // -- actions
  const actions = el('div', 'actions');
  const noteBtn = el('button', null, clip.note ? 'Edit note' : 'Add a note');
  noteBtn.type = 'button';
  noteBtn.addEventListener('click', () => editNote(row, clip));
  const del = el('button', null, 'Remove');
  del.type = 'button';
  del.addEventListener('click', () => removeClips([clip.id]));
  actions.append(noteBtn, del);
  body.append(actions);

  row.append(body);

  // -- letter avatar card (D2: never an image, never a fetched favicon)
  row.append(el('div', 'card', domainInitial(clip.domain)));
  return row;
}

/**
 * Inline note editor. Saves on blur and on Cmd/Ctrl+Enter, cancels on Escape.
 *
 * Blur-to-save rather than an explicit button: PRD principle 2 says saving costs
 * nothing, and a note the user typed and clicked away from is a note they meant to keep.
 */
function editNote(row, clip) {
  if (row.querySelector('.note-edit')) return;

  const area = el('textarea', 'note-edit');
  area.value = clip.note || '';
  area.placeholder = 'Why this mattered';

  const anchor = row.querySelector('.note') || row.querySelector('.actions');
  anchor.replaceWith(area);
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);

  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    if (save) {
      const next = collapseWhitespace(area.value);
      if (next !== clip.note) {
        clip.note = next;
        await db.putClip(clip);
        log('note saved', clip.id);
      }
    }
    render();
  };

  area.addEventListener('blur', () => commit(true));
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(true); }
  });
}

function render() {
  const t0 = performance.now();
  const list = filtered();
  const terms = tokens(state.query);
  const now = Date.now();

  const groups = $('groups');
  groups.replaceChildren();

  // Sorting by title abandons chronology, so day grouping would be meaningless.
  const buckets = new Map();
  if (state.sort === 'title') {
    buckets.set('all', list);
  } else {
    for (const clip of list) {
      const key = dayKey(clip.savedAt);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(clip);
    }
  }

  const frag = document.createDocumentFragment();
  for (const [key, clips] of buckets) {
    const section = el('section', 'group');
    const col = el('div', 'daycol');

    if (key === 'all') {
      col.append(el('div', 'weekday', 'All saves'), el('div', 'date', 'by title'));
    } else {
      const { weekday, date } = dayHeading(clips[0].savedAt);
      col.append(el('div', 'weekday', weekday), el('div', 'date', date));
    }
    col.append(el('div', 'daycount', `${clips.length} ${clips.length === 1 ? 'save' : 'saves'}`));

    const items = el('div', 'items');
    for (const clip of clips) items.append(renderClip(clip, terms, now));

    section.append(col, items);
    frag.append(section);
  }
  groups.append(frag);

  // -- summary and states
  const sites = new Set(state.clips.map((c) => c.domain).filter(Boolean)).size;
  const shown = list.length;
  $('summary').textContent = state.clips.length === 0
    ? 'Nothing saved yet'
    : `${shown} ${shown === 1 ? 'save' : 'saves'} · ${sites} ${sites === 1 ? 'site' : 'sites'} · kept in this browser`;

  const filtering = Boolean(state.query || state.from || state.to);
  $('empty').hidden = shown !== 0;
  if (shown === 0) {
    $('empty-title').textContent = filtering ? 'Nothing matches' : 'Nothing here yet';
    $('empty-body').textContent = filtering
      ? 'Clear the search or widen the dates.'
      : 'Select text on any page and save it. It will appear here.';
  }

  const n = state.selected.size;
  $('selbar').hidden = n === 0;
  $('selcount').textContent = `${n} selected`;

  log(`rendered ${shown} clips in ${(performance.now() - t0).toFixed(1)}ms`);
}

/* ================================================================== *
 * Mutations
 * ================================================================== */

function toggleSelect(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  render();
}

/**
 * Delete, reversibly. D6 and TRD §16 check 7.
 *
 * The records are held in memory while the undo is live, because the store no longer
 * has them. Deleting from the DB immediately (rather than deferring until the toast
 * expires) means a crash or a closed tab mid-undo leaves the library in the state the
 * user asked for, not a half-state.
 */
async function removeClips(ids) {
  const removed = state.clips.filter((c) => ids.includes(c.id));
  if (!removed.length) return;

  state.clips = state.clips.filter((c) => !ids.includes(c.id));
  for (const id of ids) state.selected.delete(id);
  await Promise.all(ids.map((id) => db.deleteClip(id)));
  render();

  pendingUndo = removed;
  $('undo-text').textContent = removed.length === 1
    ? 'Clip removed'
    : `${removed.length} clips removed`;
  $('undo').hidden = false;

  clearTimeout(undoTimer);
  undoTimer = setTimeout(dismissUndo, UNDO_MS);
}

async function undo() {
  if (!pendingUndo) return;
  const restore = pendingUndo;
  dismissUndo();
  await Promise.all(restore.map((clip) => db.putClip(clip)));
  state.clips = state.clips.concat(restore);
  log('restored', restore.length);
  render();
}

function dismissUndo() {
  clearTimeout(undoTimer);
  pendingUndo = null;
  $('undo').hidden = true;
}

/* ================================================================== *
 * Theme
 * ================================================================== */

async function initTheme() {
  let theme = 'light';
  try {
    const stored = await chrome.storage.local.get('theme');
    theme = stored.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch { /* storage unavailable; light is a safe default */ }
  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('theme').textContent = theme === 'dark' ? '☾' : '☀';
}

async function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // storage.local, not localStorage — the popup and onboarding read it too (TRD §5.3).
  try { await chrome.storage.local.set({ theme: next }); } catch { /* non-fatal */ }
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

function bind() {
  $('q').addEventListener('input', (e) => { state.query = e.target.value; render(); });
  $('from').addEventListener('change', (e) => { state.from = e.target.value; render(); });
  $('to').addEventListener('change', (e) => { state.to = e.target.value; render(); });

  for (const btn of document.querySelectorAll('.sort button')) {
    btn.addEventListener('click', () => {
      state.sort = btn.dataset.sort;
      for (const b of document.querySelectorAll('.sort button')) {
        b.setAttribute('aria-pressed', String(b === btn));
      }
      render();
    });
  }

  $('theme').addEventListener('click', toggleTheme);
  $('undo-btn').addEventListener('click', undo);
  $('clearsel').addEventListener('click', () => { state.selected.clear(); render(); });
  $('delsel').addEventListener('click', () => removeClips([...state.selected]));

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
    if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus(); }
    if (e.key === 'Escape' && document.activeElement === $('q')) {
      state.query = ''; $('q').value = ''; $('q').blur(); render();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && pendingUndo) { e.preventDefault(); undo(); }
  });
}

async function main() {
  bind();
  await initTheme();
  const t0 = performance.now();
  state.clips = await db.getAllClips();
  log(`loaded ${state.clips.length} clips in ${(performance.now() - t0).toFixed(1)}ms`);
  render();
}

main();
