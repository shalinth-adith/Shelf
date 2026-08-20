/**
 * Shelf — service worker.
 *
 * Empty by design. Step 1 (TRD §18) only proves the extension loads unpacked with no
 * errors; the worker gains behaviour at step 4 (context menu, commands, runtime content
 * script registration).
 *
 * ES module — declared "type": "module" in the manifest. Note that content.js, when it
 * arrives at step 5, must stay a CLASSIC script; content scripts cannot be modules.
 *
 * Two rules from TRD §10 apply to everything added here from step 4 onward, because MV3
 * terminates this worker after ~30s idle:
 *   - No module-scope mutable state that matters. The worker restarts and it is gone.
 *   - No setTimeout beyond a few seconds. Use chrome.alarms.
 * The IndexedDB connection may be cached, but must be reset in onclose and
 * onversionchange — a stale handle throws after the worker respawns.
 */

console.debug('[shelf] worker boot', new Date().toISOString());
