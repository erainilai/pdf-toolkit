import { getObject, putObject, sanitizeKeySegment, deletePrefix } from './storage.js';
import { updateJobStatus, recordUsage } from './db.js';
import { TOOLS } from './jobRegistry.js';
import { reportJobUsage } from './billing.js';

/** Executes one queued job: loads its inputs from storage, runs the tool, stores the
 *  outputs, and updates the job row. Called directly for inline (no-Redis) processing,
 *  and from src/worker.js for BullMQ-backed processing — same code, either path. */
export async function runJob({ id, tool, options, inputKeys, originalNames, mimetypes, apiKeyId }) {
  await updateJobStatus(id, 'processing');
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

    await updateJobStatus(id, 'completed', { resultFiles });
    const usageEventId = await recordUsage({ apiKeyId, tool, jobId: id, bytesIn, bytesOut });
    await reportJobUsage({ apiKeyId, usageEventId, bytesOut });
  } catch (err) {
    await updateJobStatus(id, 'failed', { error: err.message });
    throw err;
  } finally {
    // Inputs are never needed again once the job has run — delete them right away.
    await deletePrefix(`jobs/${id}/input/`).catch(() => {});
  }
}
