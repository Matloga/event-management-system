import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import env from './config/env.js';
import authRoutes from './routes/authRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import registrationRoutes from './routes/registrationRoutes.js';
import apiRoutes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

/**
 * Express application factory. Kept separate from server.js so the test
 * suite can mount the app without binding a port.
 */
export function createApp() {
  const app = express();

  // Behind Render/Railway/Azure the client IP arrives in X-Forwarded-For;
  // rate limiting needs it to be correct.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and one SVG; a strict CSP here would only get in
      // the way, and the client is served separately.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: env.allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  if (!env.isTest) {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  // Broad safety net; the auth router adds a much tighter one for credentials.
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: env.isProduction ? 600 : 5000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: {
        success: false,
        error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' },
      },
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/registrations', registrationRoutes);
  app.use('/api', apiRoutes);

  // Root banner, handy when someone opens the API URL in a browser.
  app.get('/', (_req, res) =>
    res.json({
      success: true,
      data: {
        name: 'Event Management System API',
        version: '1.0.0',
        docs: 'See README.md for the endpoint list',
        health: '/api/health',
      },
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
