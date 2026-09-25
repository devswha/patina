import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Atomically write UTF-8 text: write a unique temp file in the destination
 * directory, then rename onto the final path (rename is atomic on the same
 * filesystem). On any failure the temp file is removed and the destination is
 * left untouched, so a mid-run failure never yields a partial file.
 *
 * @param {string} destPath
 * @param {string} contents
 * @param {{ mode?: number }} [options] File mode for the new file.
 * @returns {string} the destination path
 */
export function writeAtomicUtf8(destPath, contents, { mode } = {}) {
  const dir = dirname(destPath);
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const tmp = join(dir, `.patina-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    try {
      // Exclusive create ('wx'): never clobber a preexisting temp path or symlink.
      writeFileSync(tmp, contents, { encoding: 'utf8', flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    } catch (err) {
      if (err && err.code === 'EEXIST') { lastErr = err; continue; } // name collision → retry
      throw err; // e.g. missing directory → propagate; no temp was created
    }
    try {
      renameSync(tmp, destPath);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* best-effort cleanup; destination untouched */ }
      throw err;
    }
    return destPath;
  }
  throw lastErr || new Error(`could not create a unique temp file next to ${destPath}`);
}
