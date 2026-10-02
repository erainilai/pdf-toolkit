import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileAsync } from './systemTools.js';

/** Office ↔ PDF via LibreOffice in headless mode (MPL-2.0 — fine to bundle in a hosted image).
 *  Each call gets its own temporary user profile, because two soffice processes sharing a
 *  profile block each other — this is what makes concurrent conversions safe. */

const SOFFICE = process.env.SOFFICE_PATH || 'soffice';
const TIMEOUT_MS = Number(process.env.OFFICE_TIMEOUT_MS || 120_000);

export const OFFICE_INPUTS = ['.doc', '.docx', '.odt', '.rtf', '.txt', '.xls', '.xlsx', '.ods', '.csv', '.ppt', '.pptx', '.odp'];

const TARGETS = {
  pdf: { ext: 'pdf', filter: 'pdf' },
  docx: { ext: 'docx', filter: 'docx:MS Word 2007 XML', infilter: 'writer_pdf_import' },
  xlsx: { ext: 'xlsx', filter: 'xlsx:Calc MS Excel 2007 XML' },
  pptx: { ext: 'pptx', filter: 'pptx:Impress MS PowerPoint 2007 XML', infilter: 'impress_pdf_import' },
};

async function convert(buffer, originalName, target) {
  const t = TARGETS[target];
  const dir = await mkdtemp(join(tmpdir(), 'office-'));
  try {
    const safeName = basename(originalName || 'input').replace(/[^a-zA-Z0-9._-]/g, '_') || 'input';
    const inPath = join(dir, safeName);
    await writeFile(inPath, buffer);
    const outDir = join(dir, 'out');
    const args = [
      `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
      '--headless', '--norestore', '--nolockcheck',
    ];
    if (t.infilter) args.push(`--infilter=${t.infilter}`);
    args.push('--convert-to', t.filter, '--outdir', outDir, inPath);
    try {
      await execFileAsync(SOFFICE, args, { timeout: TIMEOUT_MS });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new Error('Office conversion needs LibreOffice installed (it is included in the Docker image).');
      }
      throw new Error('LibreOffice could not convert this file.');
    }
    const files = await readdir(outDir).catch(() => []);
    const produced = files.find((f) => extname(f).toLowerCase() === `.${t.ext}`);
    if (!produced) throw new Error('LibreOffice could not convert this file.');
    const stem = basename(safeName, extname(safeName));
    return { name: `${stem}.${t.ext}`, bytes: await readFile(join(outDir, produced)) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function officeToPdf(file) {
  const ext = extname(file.originalname || '').toLowerCase();
  if (!OFFICE_INPUTS.includes(ext)) {
    throw new Error(`Unsupported file type "${ext || 'unknown'}". Supported: ${OFFICE_INPUTS.join(', ')}`);
  }
  return convert(file.buffer, file.originalname, 'pdf');
}

/** PDF → DOCX/PPTX. LibreOffice imports PDFs as positioned text boxes, so layout is kept but
 *  heavy editing is awkward. Good for "I need to change a few words", not for reflowing. */
export async function pdfToOffice(file, target) {
  if (!['docx', 'pptx'].includes(target)) throw new Error('Target must be "docx" or "pptx".');
  return convert(file.buffer, file.originalname || 'document.pdf', target);
}

export async function sheetToPdfOrXlsx(file, target) {
  return convert(file.buffer, file.originalname, target);
}
