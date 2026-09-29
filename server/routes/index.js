import { Router } from 'express';
import { z } from 'zod';
import { setUserRole } from '../controllers/authController.js';
import {
  events,
  myDashboard,
  registrationsCsv,
  stats,
  users,
} from '../controllers/adminController.js';
import { list as listCategories } from '../controllers/categoryController.js';
import { removeReview } from '../controllers/reviewController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listUsersSchema, updateRoleSchema, userIdParam } from '../validators/authValidators.js';
import { listEventsSchema } from '../validators/eventValidators.js';
import { uuid } from '../validators/common.js';
import { ping } from '../config/database.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendData } from '../utils/http.js';

const router = Router();

/* --------------------------------------------------------------- public */

// Cheap liveness probe, no auth, never touches a table.
router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const started = Date.now();
    const database = await ping().catch((err) => ({ ok: false, error: err.message }));
    return sendData(res, {
      status: database.ok ? 'healthy' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      database,
      latencyMs: Date.now() - started,
    });
  })
);

router.get('/categories', listCategories);

/* ----------------------------------------------------------------- authed */

router.get('/dashboard', requireAuth, myDashboard);

/* ----------------------------------------------------- admin-only routes
   The guard is applied per route, not with router.use(), so an unknown
   /api/* path still falls through to the 404 handler instead of 401.      */

const adminOnly = [requireAuth, requireAdmin];

router.get('/admin/stats', adminOnly, stats);
router.get('/admin/users', adminOnly, validate('query', listUsersSchema), users);
router.get('/admin/events', adminOnly, validate('query', listEventsSchema), events);
router.get('/admin/registrations.csv', adminOnly, registrationsCsv);

router.patch(
  '/admin/users/:id/role',
  adminOnly,
  validate('params', userIdParam),
  validate('body', updateRoleSchema),
  setUserRole
);

router.delete('/admin/reviews/:id', adminOnly, validate('params', z.object({ id: uuid })), removeReview);

export default router;
