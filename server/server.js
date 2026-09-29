import env from './config/env.js';
import { closePool, connect } from './config/database.js';
import { createApp } from './app.js';

/**
 * Process entry point: verify the database is reachable, then start
 * listening. Shutting down closes the pool so in-flight requests finish.
 */

const app = createApp();

async function start() {
  try {
    await connect();
    console.log(`[db] connected to ${env.DB_SERVER}/${env.dbName}`);
  } catch (err) {
    console.error('\n[db] could not connect. Check your .env values and that SQL Server is reachable.\n');
    console.error(`     ${err.message}\n`);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`\n  Event Management System API`);
    console.log(`  listening on   http://localhost:${env.PORT}`);
    console.log(`  environment    ${env.NODE_ENV}`);
    console.log(`  allowed client ${env.CLIENT_URL}\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[server] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Don't hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandled promise rejection:', reason);
});

start();
