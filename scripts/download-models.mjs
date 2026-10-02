// Downloads the background-removal model (U²-Net "u2netp", Apache-2.0, ~4.6 MB) into models/.
// Set BG_MODEL_URL to use a larger/better model (e.g. rembg's "silueta" or "isnet-general-use").
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const url = process.env.BG_MODEL_URL || 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
const dir = join(process.cwd(), 'models');
const out = process.env.BG_MODEL_PATH || join(dir, 'u2netp.onnx');

try {
  await access(out);
  console.log(`Model already present: ${out}`);
} catch {
  await mkdir(dir, { recursive: true });
  console.log(`Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`Saved ${out}`);
}
