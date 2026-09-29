import { Router } from 'express';
import { z } from 'zod';
import {
  cancel,
  checkIn,
  myTicket,
  myTickets,
  ticketQr,
} from '../controllers/registrationController.js';
import { requireAuth, requireOrganizer } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uuid } from '../validators/common.js';

const router = Router();

// Everything under this router is about the signed-in user's own ticket(s).
router.use(requireAuth);

const eventIdParams = validate('params', z.object({ eventId: uuid }));

const checkInBody = validate(
  'body',
  z
    .object({
      token: z.string().trim().min(8, 'A QR token is required').max(64),
      eventId: uuid.optional(),
    })
    .strict()
);

/** GET /api/registrations/mine?scope=upcoming|past|all */
router.get('/mine', myTickets);
router.get('/mine/:eventId', eventIdParams, myTicket);
router.get('/mine/:eventId/qr.svg', eventIdParams, ticketQr);

/**
 * POST /api/registrations/check-in
 * Door scanning. Organizers and admins only - an attendee redeeming their own
 * code goes through the ticket page instead.
 */
router.post('/check-in', requireOrganizer, checkInBody, checkIn);

/** DELETE /api/registrations/:eventId - cancel the caller's own seat. */
router.delete('/:eventId', eventIdParams, cancel);

export default router;
