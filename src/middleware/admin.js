/** Gates admin-only routes. Relies on sessionContext (mounted globally on /api) having
 *  already resolved req.user from the session cookie. */
export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}
