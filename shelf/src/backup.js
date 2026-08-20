/**
 * Shelf — backup and restore. TRD §13.
 *
 * The pure half (serialise, parse, validate) is separated from the File System Access
 * half deliberately: the pure functions are tested in Node, and the browser half is
 * thin enough to read in one sitting.
 *
 * WHY THIS LIVES ON THE SHELF PAGE AND NOT IN THE WORKER
 *
 * Directory handles lose permission across browser restarts. Regaining it means
 * requestPermission(), which requires a user gesture — and a service worker can never
 * obtain one. A worker-driven backup would therefore work until the first restart and
 * then silently stop, which is the worst possible failure for a backup: it looks fine
 * and it is not running. So it runs when the shelf is opened, where a gesture exists.
 */

/** Bump if the file shape changes in a way a reader must branch on. */
export const BACKUP_VERSION = 1;
export const BACKUP_FILENAME = 'shelf-backup.json';

/** Back up if the last one is older than this. TRD §13. */
export const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** How long someone may go with no backup at all before the warning escalates. PRD §12. */
export const NAG_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether this browser can write to a folder at all. Safari is expected to say no. */
export function supportsDirectoryBackup() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

/* ================================================================== *
 * Serialisation — pure
 * ================================================================== */

/**
 * A backup, unlike an export, is FULL FIDELITY. Every field is kept, including the ones
 * export.js deliberately withholds — context, urlHash, isPublic. The distinction is who
 * the file is for: an export is published to other people, a backup is the user's own
 * archive and must restore the library exactly.
 *
 * Deterministic for the same reason the export is, and one more: this file is meant to
 * live in a Dropbox or iCloud folder (PRD §9 sells that as the sync story). Rewriting
 * identical content with a fresh timestamp inside would trigger a sync every 12 hours
 * forever. The write is also skipped entirely when the bytes have not changed — see
 * writeBackup().
 *
 * @param {object[]} clips
 * @returns {string}
 */
export function buildBackupJson(clips) {
  const sorted = [...clips].sort((a, b) => (b.savedAt - a.savedAt) || (a.id < b.id ? -1 : 1));
  return JSON.stringify({ format: 'shelf-backup', version: BACKUP_VERSION, clips: sorted }, null, 2);
}

/**
 * Parse a backup file. Never throws on bad input — returns a reason instead, because the
 * caller is a person who just picked the wrong file and deserves to be told which.
 *
 * @param {string} text
 * @returns {{ok: true, clips: object[]} | {ok: false, error: string}}
 */
export function parseBackupJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'That file is not a Shelf backup.' };
  if (data.format !== 'shelf-backup') return { ok: false, error: 'That file is not a Shelf backup.' };
  if (!Array.isArray(data.clips)) return { ok: false, error: 'That backup has no clips in it.' };
  if (data.version > BACKUP_VERSION) {
    return { ok: false, error: `That backup was written by a newer version of Shelf (v${data.version}).` };
  }

  // Drop anything unusable rather than failing the whole restore. A backup with one bad
  // record should still return the other 1,499 clips.
  const clips = data.clips.filter((c) => c && typeof c.id === 'string' && typeof c.savedAt === 'number');
  return { ok: true, clips };
}

/* ================================================================== *
 * File System Access
 * ================================================================== */

/**
 * Ask for a folder. Must be called from a user gesture.
 * @returns {Promise<FileSystemDirectoryHandle|null>} null if the picker was dismissed
 */
export async function pickBackupDirectory() {
  try {
    return await globalThis.showDirectoryPicker({ id: 'shelf-backup', mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return null;   // dismissed; not an error
    throw err;
  }
}

/**
 * Do we still hold write access to this handle?
 *
 * queryPermission never prompts, so it is safe anywhere. requestPermission prompts and
 * therefore needs a gesture — which is why `interactive` is opt-in and the automatic
 * path never sets it.
 *
 * @param {FileSystemDirectoryHandle} handle
 * @param {boolean} interactive may we prompt?
 */
export async function hasWriteAccess(handle, interactive = false) {
  if (!handle?.queryPermission) return false;
  const opts = { mode: 'readwrite' };
  if (await handle.queryPermission(opts) === 'granted') return true;
  if (!interactive) return false;
  return await handle.requestPermission(opts) === 'granted';
}

/**
 * Write the backup, skipping the write when nothing changed.
 *
 * The skip matters because the target is usually a synced folder. Writing identical
 * bytes every 12 hours would wake Dropbox, re-upload, and burn the user's bandwidth and
 * version history to say nothing new.
 *
 * @returns {Promise<{written: boolean, bytes: number}>}
 */
export async function writeBackup(handle, json) {
  const file = await handle.getFileHandle(BACKUP_FILENAME, { create: true });

  try {
    const existing = await (await file.getFile()).text();
    if (existing === json) return { written: false, bytes: json.length };
  } catch {
    /* no existing file, or unreadable — fall through and write */
  }

  const stream = await file.createWritable();
  await stream.write(json);
  await stream.close();
  return { written: true, bytes: json.length };
}

/** Fallback for browsers with no directory access, and always available besides. */
export function downloadJson(json, filename = BACKUP_FILENAME) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
