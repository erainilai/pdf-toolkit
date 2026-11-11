import { isToolDisabled } from '../lib/db.js';

/** Blocks a request if the tool (an admin can disable one from /admin, e.g. while it's
 *  broken) is currently disabled. `toolIdOrFn` is either a fixed tool id (the 13 hand-written
 *  routes in src/routes/api.js) or a function of req (the generic /tool/:tool route). */
export function requireToolEnabled(toolIdOrFn) {
  return async (req, res, next) => {
    const toolId = typeof toolIdOrFn === 'function' ? toolIdOrFn(req) : toolIdOrFn;
    if (await isToolDisabled(toolId)) {
      return res.status(503).json({ error: 'This tool is temporarily unavailable. Please try again later.', code: 'tool_disabled' });
    }
    next();
  };
}
