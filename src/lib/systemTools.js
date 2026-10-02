import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function which(bin) {
  try {
    await execFileAsync('which', [bin]);
    return true;
  } catch {
    return false;
  }
}

let cache = null;

/** Detects optional system binaries once at startup. These unlock stronger features
 *  (real password encryption via qpdf, deeper compression via ghostscript) but the
 *  app runs fully without them — callers should check availability and degrade gracefully. */
export async function detectSystemTools() {
  if (cache) return cache;
  const [qpdf, ghostscript, libreoffice] = await Promise.all([which('qpdf'), which('gs'), which(process.env.SOFFICE_PATH || 'soffice')]);
  cache = { qpdf, ghostscript, libreoffice };
  return cache;
}

export { execFileAsync };
