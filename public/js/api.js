/* Small client for the browser API. All calls are same-origin with the session cookie. */

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code);
  return data;
}

export const getJSON = (url) => fetch(url, { credentials: 'same-origin' }).then(parse);
export const postJSON = (url, body) => fetch(url, {
  method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
}).then(parse);

/** Uploads a job with progress (fetch can't report upload progress, XHR can). */
export function submitJob(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/jobs');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data.error || `Upload failed (${xhr.status})`, xhr.status, data.code));
    };
    xhr.onerror = () => reject(new ApiError('Network error — check your connection and try again.', 0));
    xhr.send(formData);
  });
}

/** Polls a job until it finishes. Backs off gently so long OCR jobs don't spam the server. */
export async function waitForJob(id, onTick, { signal } = {}) {
  let delay = 600;
  for (;;) {
    if (signal?.aborted) throw new ApiError('Cancelled', 0, 'cancelled');
    const job = await getJSON(`/api/jobs/${id}`);
    onTick?.(job);
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'expired') return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 3000);
  }
}
