/**
 * Shelf — service worker.
 *
 * Owns every write (TRD §4). The shelf page reads IndexedDB directly, but nothing else
 * writes to it: content.js and the popup send messages here instead.
 *
 * ES module, per "type": "module" in the manifest. content.js is a CLASSIC script and
 * cannot import from here — it talks over the message protocol in §8.
 *
 * TRD §10, because MV3 tears this worker down after ~30s idle:
 *   - No module-scope mutable state that matters. Everything below is either a constant
 *     or derived per-call. The worker restarts and loses nothing.
 *   - No setTimeout beyond a couple of seconds. The badge flash is the only timer here
 *     and it is 1.6s; anything longer would need chrome.alarms.
 *   - The IndexedDB handle is cached in db.js, which resets it on close. See withDb().
 */

import * as db from './db.js';
import {
  NORMALIZE_VERSION, normalizeUrl, urlHash, domainOf, collapseWhitespace,
} from './util.js';

const MENU_ID = 'shelf-save-selection';

/** Fallback when storage.local has no defaultColor yet. TRD §5.3. */
const DEFAULT_COLOR = 'yellow';

const log = (...args) => console.debug('[shelf:sw]', ...args);

/* ================================================================== *
 * Clip assembly
 * ================================================================== */

/**
 * Build a clip record from a capture. Shape is TRD §5.1.
 *
 * Pure apart from the id, the clock, and one storage read — deliberately so, because
 * every save path (context menu now; the bar and popup later) funnels through here and
 * must produce identical records. A second assembly site is how the two paths drift.
 *
 * @param {object} capture
 * @param {string} capture.text     the passage, pre-collapse
 * @param {string} capture.url      source URL, timestamp included if media (TRD §7.2)
 * @param {string} [capture.title]
 * @param {{prefix?: string, suffix?: string}} [capture.context]
 * @param {number|null} [capture.seconds]
 * @param {string} [capture.color]
 * @param {string} [capture.note]
 * @returns {Promise<object>}
 */
async function buildClip(capture) {
  const url = String(capture.url ?? '').trim();
  const canonicalUrl = normalizeUrl(url);

  return {
    id: crypto.randomUUID(),
    text: collapseWhitespace(capture.text),
    note: collapseWhitespace(capture.note ?? ''),
    color: capture.color || (await defaultColor()),

    url,
    canonicalUrl,
    urlHash: await urlHash(canonicalUrl),
    // Version the rules that produced this hash, so a future rule change can find the
    // records that need rehashing instead of silently orphaning them. TRD §5.4.
    normalizeVersion: NORMALIZE_VERSION,

    domain: domainOf(url),
    title: collapseWhitespace(capture.title ?? ''),

    // TRD §6's hedge. Unused in v1. Empty from the context-menu path — info.selectionText
    // arrives without a Range, so there is nothing to take prefix/suffix from. The save
    // bar supplies both at step 5.
    context: {
      prefix: String(capture.context?.prefix ?? '').slice(0, 32),
      suffix: String(capture.context?.suffix ?? '').slice(0, 32),
    },

    seconds: Number.isFinite(capture.seconds) ? Math.floor(capture.seconds) : null,
    savedAt: Date.now(),
    isPublic: false,     // export inclusion is opt-in, never a default. TRD §12.
  };
}

/** defaultColor from storage.local, with a fallback. TRD §5.3. */
async function defaultColor() {
  try {
    const { defaultColor: c } = await chrome.storage.local.get('defaultColor');
    return c || DEFAULT_COLOR;
  } catch {
    return DEFAULT_COLOR;
  }
}

/**
 * Assemble, write, and report. The single write path.
 *
 * PRD §8.1: the clip is written before any confirmation renders. The badge flash below
 * happens strictly after the transaction commits, so a user who navigates away the
 * instant they click has still saved.
 *
 * @returns {Promise<{ok: true, id: string, pageCount: number} | {ok: false, error: string}>}
 */
async function saveClip(capture) {
  try {
    const clip = await buildClip(capture);

    if (!clip.text) {
      // TRD principle: never guess at content. Nothing to save is not an error, but it
      // is not a save either — say so rather than writing an empty record.
      log('save skipped — empty text');
      return { ok: false, error: 'empty' };
    }

    await db.addClip(clip);
    const pageCount = await db.countByUrlHash(clip.urlHash);
    // The source tag distinguishes the three save paths in the log. They all funnel
    // through here by design (§8), which makes them indistinguishable without it.
    log('saved via', capture.source || 'unknown', '—', clip.id, clip.domain,
        'pageCount', pageCount);

    flashBadge('✓', '#1F5C5C');
    return { ok: true, id: clip.id, pageCount };
  } catch (err) {
    console.error('[shelf:sw] save failed', err);
    flashBadge('!', '#8A5A1F');
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Brief toolbar-badge confirmation.
 *
 * The context menu is the one save path with no UI of its own (TRD §9.1 — it works on
 * sites with no permission granted, where no content script can run). Without this the
 * user gets no signal at all that anything happened.
 */
function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1600);
}

/* ================================================================== *
 * Context menu — the universal fallback, TRD §9.1
 *
 * info.selectionText arrives with the click, independent of host permissions. This is
 * why it is the first save path built: it is the only one that works everywhere, and
 * everything else degrades to it.
 * ================================================================== */

/**
 * In-flight installation, so concurrent callers share one pass rather than racing
 * removeAll against create.
 *
 * This IS module-scope mutable state, which §10 warns about — but it is a cache whose
 * loss is harmless. When the worker respawns it resets to null and the menu is simply
 * reinstalled, which is exactly what we want.
 * @type {Promise<void> | null}
 */
let menuReady = null;

function ensureContextMenu() {
  if (!menuReady) menuReady = installContextMenu();
  return menuReady;
}

async function installContextMenu() {
  try {
    // removeAll before create, or a duplicate id throws on every pass that re-runs
    // installation.
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Save selection to Shelf',
      contexts: ['selection'],
    });
    log('context menu installed');
  } catch (err) {
    menuReady = null;               // let the next caller retry
    console.error('[shelf:sw] context menu install failed', err);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  saveClip({
    source: 'context-menu',
    text: info.selectionText ?? '',
    // info.pageUrl is present even without host permissions; tab.url may not be.
    url: info.pageUrl ?? tab?.url ?? '',
    title: tab?.title ?? '',
  });
});

/* ================================================================== *
 * Lifecycle
 * ================================================================== */

chrome.runtime.onInstalled.addListener(async (details) => {
  log('onInstalled', details.reason);
  await ensureContextMenu();

  // First-run stamp. Onboarding's "no backup yet" escalation counts from here (PRD §9).
  if (details.reason === 'install') {
    const existing = await db.getMeta('installedAt');
    if (existing === undefined) await db.setMeta('installedAt', Date.now());
  }
});

// Menus survive worker teardown but not always a browser restart. Cheap to re-assert.
chrome.runtime.onStartup.addListener(() => {
  log('onStartup');
  ensureContextMenu();
  syncContentScripts();
});

/* ================================================================== *
 * Runtime content-script registration — TRD §9
 *
 * The save bar only exists on origins the user has explicitly granted. Nothing is
 * declared in the manifest, because a static content_scripts block would require
 * host_permissions at install — the exact thing §9 forbids.
 *
 * Re-synced on every worker spawn and whenever permissions change, so granting a site
 * takes effect without a browser restart.
 * ================================================================== */

const SCRIPT_ID = 'shelf-bar';

async function syncContentScripts() {
  try {
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = origins.filter((o) => o.startsWith('http://') || o.startsWith('https://'));

    // Unregister before registering, or a duplicate id throws (§9). Absent id also
    // throws, hence the swallow — there is no "unregister if present".
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    } catch {
      /* not registered yet */
    }

    if (!matches.length) {
      log('content scripts: no granted origins');
      return;
    }

    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      js: ['src/content.js'],
      matches,
      runAt: 'document_idle',
      allFrames: false,
      world: 'ISOLATED',
    }]);
    log('content scripts registered for', matches.length, 'origin(s)');

    await injectIntoOpenTabs(matches);
  } catch (err) {
    console.error('[shelf:sw] content script sync failed', err);
  }
}

/**
 * Registration only affects future navigations. Without this, granting a site does
 * nothing until the user reloads — which reads as the grant having failed.
 *
 * content.js guards on window.__shelfLoaded, so injecting into a tab that already has
 * it is a no-op.
 */
async function injectIntoOpenTabs(matches) {
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
    } catch (err) {
      // Expected on pages an extension may never touch: the web store, chrome:// pages,
      // PDFs. Not worth failing the whole sync over.
      log('inject skipped for tab', tab.id, String(err && err.message));
    }
  }));
}

/**
 * Toolbar click → request access to the current site.
 *
 * TEMPORARY. Step 9's popup owns this properly, with per-site state and the count of
 * clips from this page. It exists now because TRD §18 has an ordering gap: step 5 builds
 * the save bar, the bar needs a granted origin, and nothing before step 9 can grant one.
 * chrome.permissions.request() requires a user gesture, and a devtools console is not
 * one — so the gesture has to come from extension UI. A toolbar click is the smallest
 * piece of UI that qualifies.
 *
 * Only fires while the action has no default_popup. Adding one at step 9 disables this
 * listener automatically, which is the intended handover.
 */
chrome.action.onClicked.addListener((tab) => {
  const origins = originPatternFor(tab && tab.url);
  if (!origins) {
    // chrome://, about:, the Web Store, PDFs — pages no extension may ever touch.
    log('cannot request access for', tab && tab.url);
    flashBadge('—', '#8A5A1F');
    return;
  }

  // NO await before request(). User activation expires across an await, and the call
  // then rejects with "must be called during a user gesture" — a genuinely confusing
  // failure, because the code looks correct. Already-granted origins resolve true
  // immediately without prompting, so checking first buys nothing anyway.
  chrome.permissions.request({ origins })
    .then((granted) => {
      log('permission request for', origins[0], granted ? 'granted' : 'denied');
      flashBadge(granted ? '✓' : '✕', granted ? '#1F5C5C' : '#8A5A1F');
      // permissions.onAdded does the registration and open-tab injection.
    })
    .catch((err) => {
      console.error('[shelf:sw] permission request failed', err);
      flashBadge('!', '#8A5A1F');
    });
});

/**
 * Match pattern for a URL's origin, or null if the page is one extensions cannot access.
 * @param {string|undefined} url
 * @returns {string[]|null}
 */
function originPatternFor(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return [u.origin + '/*'];
  } catch {
    return null;
  }
}

chrome.permissions.onAdded.addListener((p) => {
  log('permissions added', p.origins);
  syncContentScripts();
});

chrome.permissions.onRemoved.addListener((p) => {
  log('permissions removed', p.origins);
  syncContentScripts();
});

/* ================================================================== *
 * Message protocol — TRD §8
 * ================================================================== */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  switch (msg.type) {
    case 'SAVE_CLIP':
      saveClip(msg.payload ?? {}).then(sendResponse);
      return true;      // keep the channel open for the async reply

    case 'PAGE_STATE':
      pageState(msg.payload ?? {}).then(sendResponse);
      return true;

    default:
      return false;
  }
});

/**
 * What the popup needs to render: how many clips from this page, how many overall, and
 * whether this origin has been granted host access. TRD §8.
 */
async function pageState({ url }) {
  try {
    const canonical = normalizeUrl(String(url ?? ''));
    const [pageCount, total, granted] = await Promise.all([
      db.countByUrlHash(await urlHash(canonical)),
      db.countClips(),
      hasHostPermission(url),
    ]);
    return { ok: true, pageCount, total, granted };
  } catch (err) {
    console.error('[shelf:sw] pageState failed', err);
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/**
 * Has the user granted host access for this URL?
 *
 * Never requests — only asks. Requesting requires a user gesture and belongs to the
 * popup's explicit grant button (step 9). TRD §9: never broad host access at install.
 */
async function hasHostPermission(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return await chrome.permissions.contains({ origins: [u.origin + '/*'] });
  } catch {
    return false;
  }
}

/* ================================================================== *
 * Debug handle — see step 2's acceptance check.
 * Worker global scope is extension-private; no page or content script reaches it.
 * ================================================================== */

globalThis.shelfDb = db;
globalThis.shelfSave = saveClip;

/**
 * Install on every worker spawn.
 *
 * onInstalled fires once per install or update; onStartup once per browser launch.
 * Neither fires when MV3 tears the worker down for idling and respawns it on the next
 * event — and if the menu was ever lost, nothing would put it back until the browser
 * restarted. Context menus are cheap to re-assert, and the universal fallback save path
 * (§9.1) is the last thing that should depend on a lifecycle event firing.
 */
ensureContextMenu();
syncContentScripts();

console.debug('[shelf] worker boot', new Date().toISOString());
