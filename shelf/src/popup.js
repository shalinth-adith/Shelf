/**
 * Shelf — toolbar popup.
 *
 * Four states, chosen in this order:
 *   restricted  the page is one no extension may touch
 *   grant       http(s) page, no host permission yet
 *   page        the ordinary case
 *   saved       after a save
 *
 * The grant state is the mitigation PRD §12 names for its highest-severity product risk
 * — "permissions not granted, bar never appears, reads as broken". It is also why the
 * copy leads with the fact that right-click already works: the user should never
 * conclude the product is broken, only that this site is not connected yet.
 */

import { domainInitial, collapseWhitespace } from './util.js';

const log = (...a) => console.debug('[shelf:popup]', ...a);
const $ = (id) => document.getElementById(id);

/** Warn about storage above this fraction of quota. */
const STORAGE_WARN = 0.85;

let tab = null;
let pageState = null;

function show(id) {
  for (const s of document.querySelectorAll('section')) s.hidden = s.id !== id;
}

/* ================================================================== *
 * The excerpt ladder — TRD §7.3
 *
 * Serialised into the page by chrome.scripting.executeScript, so it must be entirely
 * self-contained: no imports, no closures, no references to anything in this module.
 *
 * The last rung is the important one. It returns NOTHING rather than falling through to
 * body.innerText, which on an app-shell page yields navigation labels, sidebar
 * recommendations and subscriber counts. An empty excerpt reads as intentional; scraped
 * page furniture reads as broken. PRD principle 4.
 * ================================================================== */
function excerptLadder() {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  // 1. Social and standard meta descriptions.
  for (const sel of ['meta[property="og:description"]',
                     'meta[name="twitter:description"]',
                     'meta[name="description"]']) {
    const v = clean(document.querySelector(sel)?.content);
    if (v) return { text: v, source: sel };
  }

  // 2. JSON-LD.
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const seen = [JSON.parse(node.textContent)];
      while (seen.length) {
        const item = seen.pop();
        if (Array.isArray(item)) { seen.push(...item); continue; }
        if (!item || typeof item !== 'object') continue;
        const v = clean(item.description || item.articleBody);
        if (v) return { text: v, source: 'json-ld' };
        seen.push(...Object.values(item).filter((x) => x && typeof x === 'object'));
      }
    } catch { /* malformed JSON-LD is common; ignore this block */ }
  }

  // 3. An <article>, if it is substantial.
  const article = clean(document.querySelector('article')?.innerText);
  if (article.length > 200) return { text: article.slice(0, 600), source: 'article' };

  // 4. Nothing. Never body.innerText.
  return { text: '', source: 'none' };
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

function originPattern(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin + '/*';
  } catch {
    return null;
  }
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  const pattern = originPattern(url);

  // Theme is shared with the shelf page (TRD §5.3).
  try {
    const { theme } = await chrome.storage.local.get('theme');
    document.documentElement.dataset.theme = theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch { /* light is a safe default */ }

  pageState = await chrome.runtime.sendMessage({ type: 'PAGE_STATE', payload: { url } });
  if (pageState?.ok) {
    $('total').textContent = `${pageState.total} saved`;
  }

  await renderStorage();

  if (!pattern) return show('s-restricted');
  if (!pageState?.granted) {
    $('grant-host').textContent = new URL(url).hostname.replace(/^www\./, '');
    return show('s-grant');
  }
  renderPage();
}

function renderPage() {
  const host = new URL(tab.url).hostname.replace(/^www\./, '');
  $('avatar').textContent = domainInitial(host);
  $('domain').textContent = host;
  $('title').textContent = tab.title || host;

  const n = pageState?.pageCount ?? 0;
  $('already').hidden = n === 0;
  $('already').textContent = n === 1
    ? 'Already 1 clip from this page'
    : `Already ${n} clips from this page`;

  show('s-page');
  $('note').focus();
}

/**
 * Storage pressure. Kept from the canvas; D2 changed the remedy, since there are no
 * thumbnails to clear — the answer is to get a copy out of the browser.
 */
async function renderStorage() {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota) return;
    const ratio = usage / quota;
    if (ratio < STORAGE_WARN) return;
    $('storage-text').textContent =
      `${Math.round(ratio * 100)}% of local storage used — back up and export soon.`;
    $('storage-fill').style.width = `${Math.round(ratio * 100)}%`;
    $('storage').hidden = false;
  } catch { /* estimate() unavailable; not worth surfacing */ }
}

async function grant() {
  const pattern = originPattern(tab.url);
  if (!pattern) return;
  $('grant').disabled = true;
  // A popup click is a user gesture, so this is where request() belongs — and why the
  // temporary action.onClicked handler from step 5 could be deleted.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  log('grant', pattern, granted);
  if (!granted) {
    $('grant').disabled = false;
    return;
  }
  pageState = await chrome.runtime.sendMessage({ type: 'PAGE_STATE', payload: { url: tab.url } });
  renderPage();
}

async function savePage() {
  $('save').disabled = true;
  $('save').textContent = 'Saving…';

  let excerpt = { text: '', source: 'none' };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: excerptLadder,
    });
    excerpt = result?.result ?? excerpt;
  } catch (err) {
    // Not fatal. A page-save with no excerpt is still a save — PRD principle 4 says an
    // empty excerpt is intentional, not a failure.
    log('excerpt ladder unavailable', err?.message);
  }
  log('excerpt from', excerpt.source, `${excerpt.text.length} chars`);

  const res = await chrome.runtime.sendMessage({
    type: 'SAVE_CLIP',
    payload: {
      source: 'popup',
      text: excerpt.text,
      url: tab.url,
      title: tab.title ?? '',
      note: collapseWhitespace($('note').value),
    },
  });

  if (!res?.ok) {
    $('save').disabled = false;
    $('save').textContent = 'Save page';
    $('hint').textContent = res?.error === 'empty'
      ? 'Nothing on this page could be read. Select text and use the save bar.'
      : 'Save failed. Try again.';
    return;
  }

  $('saved-text').textContent = res.pageCount > 1
    ? `Saved · ${res.pageCount} from this page`
    : 'Saved to your library';
  $('saved-title').textContent = tab.title || '';
  $('saved-meta').textContent = new URL(tab.url).hostname.replace(/^www\./, '')
    + (excerpt.source === 'none' ? ' · no excerpt found' : '');
  show('s-saved');
}

function openShelf() {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/shelf.html') });
  window.close();
}

$('grant').addEventListener('click', grant);
$('save').addEventListener('click', savePage);
$('open').addEventListener('click', openShelf);
$('saved-open').addEventListener('click', openShelf);
$('saved-note').addEventListener('click', openShelf);
$('note').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) savePage();
});

init();
