import { verifyApiKey } from '../lib/db.js';

export function apiKeyAuth(req, res, next) {
  const header = req.header('x-api-key') || (req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!header) {
    return res.status(401).json({ error: 'Missing API key. Pass it in the X-API-Key header.' });
  }
  const keyRow = verifyApiKey(header);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid or revoked API key.' });
  }
  req.apiKey = keyRow;
  next();
}
