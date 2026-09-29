import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  changePassword,
  login,
  logout,
  me,
  register,
  updateProfile,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../validators/authValidators.js';
import { sendData } from '../utils/http.js';

const router = Router();

/** Credential endpoints get a tighter budget than the rest of the API. */
const credentialsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } },
});

router.post('/register', credentialsLimiter, validate('body', registerSchema), register);
router.post('/login', credentialsLimiter, validate('body', loginSchema), login);
router.post('/logout', logout);

router.get('/me', requireAuth, me);
router.patch('/profile', requireAuth, validate('body', updateProfileSchema), updateProfile);
router.post('/password', requireAuth, credentialsLimiter, validate('body', changePasswordSchema), changePassword);

export default router;
