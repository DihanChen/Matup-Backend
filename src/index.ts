import { env, validateEnv } from './config/env';
import app from './app';

validateEnv();

const server = app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
  console.log(`Environment: ${env.nodeEnv}`);
  console.log(`Health check: http://localhost:${env.port}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});
