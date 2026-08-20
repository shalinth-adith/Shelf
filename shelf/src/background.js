/**
 * Shelf — service worker.
 *
 * Still behaviourless. Step 2 (TRD §18) only needs db.js reachable from this worker's
 * console; the context menu, message handlers, and runtime content-script registration
 * all arrive at step 4.
 *
 * ES module — declared "type": "module" in the manifest. content.js, at step 5, must stay
 * a CLASSIC script; content scripts cannot be modules.
 *
 * TRD §10, applying to everything added here from step 4 onward, because MV3 terminates
 * this worker after ~30s idle:
 *   - No module-scope mutable state that matters. The worker restarts and it is gone.
 *   - No setTimeout beyond a few seconds. Use chrome.alarms.
 * db.js already handles its own connection staleness; see withDb() there.
 */

import * as db from './db.js';

/**
 * Debugging handle. Lets the worker's devtools console reach the database directly:
 *
 *   await shelfDb.addClip({ id: crypto.randomUUID(), text: 'hello', savedAt: Date.now() })
 *   await shelfDb.getClip('<that id>')
 *
 * Safe to ship. A service worker's global scope is extension-private — no web page, no
 * content script, and no other extension can reach it. The alternative, gating this behind
 * a chrome.management call, would mean requesting a permission purely to hide a console
 * convenience, which is a worse trade.
 */
globalThis.shelfDb = db;

console.debug('[shelf] worker boot', new Date().toISOString());
