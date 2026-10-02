import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileAsync, detectSystemTools } from './systemTools.js';

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'pdftk-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function protectPdf(buffer, password) {
  const { qpdf } = await detectSystemTools();
  if (!qpdf) {
    throw new Error(
      "Password protection needs the 'qpdf' tool, which isn't installed on this machine. " +
      'Install it with "brew install qpdf" (macOS) and try again.'
    );
  }
  return withTempDir(async (dir) => {
    const inPath = join(dir, 'in.pdf');
    const outPath = join(dir, 'out.pdf');
    await writeFile(inPath, buffer);
    await execFileAsync('qpdf', [
      '--encrypt', password, password, '256', '--', inPath, outPath,
    ]);
    return readFile(outPath);
  });
}

export async function unlockPdf(buffer, password) {
  const { qpdf } = await detectSystemTools();
  if (!qpdf) {
    throw new Error(
      "Removing passwords needs the 'qpdf' tool, which isn't installed on this machine. " +
      'Install it with "brew install qpdf" (macOS) and try again.'
    );
  }
  return withTempDir(async (dir) => {
    const inPath = join(dir, 'in.pdf');
    const outPath = join(dir, 'out.pdf');
    await writeFile(inPath, buffer);
    try {
      await execFileAsync('qpdf', ['--password=' + password, '--decrypt', '--', inPath, outPath]);
    } catch (err) {
      throw new Error('Could not unlock the PDF — check the password is correct.');
    }
    return readFile(outPath);
  });
}

export async function compressPdfStrong(buffer, quality = 'ebook') {
  const { ghostscript } = await detectSystemTools();
  if (!ghostscript) return null;
  return withTempDir(async (dir) => {
    const inPath = join(dir, 'in.pdf');
    const outPath = join(dir, 'out.pdf');
    await writeFile(inPath, buffer);
    await execFileAsync('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=/${quality}`,
      '-dNOPAUSE', '-dBATCH', '-dQUIET',
      `-sOutputFile=${outPath}`,
      inPath,
    ]);
    return readFile(outPath);
  });
}
