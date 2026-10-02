import { getObject, putObject, sanitizeKeySegment } from './storage.js';
import { updateJobStatus, recordUsage } from './db.js';
import { TOOLS } from './jobRegistry.js';

/** Executes one queued job: loads its inputs from storage, runs the tool, stores the
 *  outputs, and updates the job row. Called directly for inline (no-Redis) processing,
 *  and from src/worker.js for BullMQ-backed processing — same code, either path. */
export async function runJob({ id, tool, options, inputKeys, originalNames, mimetypes, apiKeyId }) {
  updateJobStatus(id, 'processing');
  try {
    const handler = TOOLS[tool];
    if (!handler) throw new Error(`Unknown tool: ${tool}`);

    const files = await Promise.all(
      inputKeys.map(async (key, i) => ({
        buffer: await getObject(key),
        mimetype: mimetypes?.[i],
        originalname: originalNames?.[i],
      }))
    );
    const bytesIn = files.reduce((sum, f) => sum + f.buffer.length, 0);

    const outputs = await handler(files, options || {});
    const resultFiles = [];
    let bytesOut = 0;
    for (const out of outputs) {
      const safeName = sanitizeKeySegment(out.name);
      const storageKey = `jobs/${id}/output/${safeName}`;
      await putObject(storageKey, out.bytes);
      resultFiles.push({ name: out.name, storageKey, size: out.bytes.length });
      bytesOut += out.bytes.length;
    }

    updateJobStatus(id, 'completed', { resultFiles });
    recordUsage({ apiKeyId, tool, jobId: id, bytesIn, bytesOut });
  } catch (err) {
    updateJobStatus(id, 'failed', { error: err.message });
    throw err;
  }
}
