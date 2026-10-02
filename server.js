import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import multer from 'multer';
import apiRouter from './src/routes/api.js';
import v1Router from './src/routes/v1.js';
import { initDb } from './src/lib/db.js';
import { queueMode } from './src/lib/queue.js';
import { storageBackend } from './src/lib/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

initDb();

app.get('/healthz', (req, res) => res.json({ ok: true, queueMode, storage: storageBackend() }));
app.use(express.static(join(__dirname, 'public')));
app.use('/api', apiRouter);
app.use('/api/v1', v1Router);

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (200MB limit).' : err.message;
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

const PORT = process.env.PORT || 4321;
app.listen(PORT, () => {
  console.log(`\n  PDF Toolkit running → http://localhost:${PORT}\n`);
});
