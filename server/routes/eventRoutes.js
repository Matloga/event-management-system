import { Router } from 'express';
import {
  create,
  detail,
  feature,
  home,
  list,
  mine,
  publish,
  remove,
  update,
} from '../controllers/eventController.js';
import { attendees, attendeesCsv, cancel, register } from '../controllers/registrationController.js';
import { addReview, eventReviews } from '../controllers/reviewController.js';
import { optionalAuth, requireAdmin, requireAuth, requireOrganizer } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  attendeesSchema,
  createEventSchema,
  eventIdParam,
  featureSchema,
  listEventsSchema,
  publishSchema,
  reviewSchema,
  updateEventSchema,
} from '../validators/eventValidators.js';

const router = Router();

/* ------------------------------------------------------------ collections */

// Browsing is public; optionalAuth lets us mark "yours" on the way through.
router.get('/', optionalAuth, validate('query', listEventsSchema), list);
router.get('/home', home);

// Declared before '/:id' so "mine" is not swallowed as an id.
router.get('/mine', requireAuth, mine);

/* ------------------------------------------------------------- one event */
router.get('/:id', optionalAuth, validate('params', eventIdParam), detail);

router.post('/', requireAuth, requireOrganizer, validate('body', createEventSchema), create);
router.patch('/:id', requireAuth, validate('params', eventIdParam), validate('body', updateEventSchema), update);
router.patch('/:id/publish', requireAuth, validate('params', eventIdParam), validate('body', publishSchema), publish);
router.patch('/:id/feature', requireAuth, requireAdmin, validate('params', eventIdParam), validate('body', featureSchema), feature);
router.delete('/:id', requireAuth, validate('params', eventIdParam), remove);

/* --------------------------------------------------------- registrations */
router.post('/:id/register', requireAuth, validate('params', eventIdParam), register);
router.delete('/:id/register', requireAuth, validate('params', eventIdParam), cancel);

/* -------------------------------------------------------------- attendees */
router.get('/:id/attendees', requireAuth, validate('params', eventIdParam), validate('query', attendeesSchema), attendees);
router.get('/:id/attendees.csv', requireAuth, validate('params', eventIdParam), validate('query', attendeesSchema.partial()), attendeesCsv);

/* ---------------------------------------------------------------- reviews */
router.get('/:id/reviews', validate('params', eventIdParam), eventReviews);
router.post('/:id/reviews', requireAuth, validate('params', eventIdParam), validate('body', reviewSchema), addReview);

export default router;
