import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import emailRoutes from './routes/email';

const app = express();

// Security middleware
app.use(helmet());

// CORS - allow frontend
const devOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const prodOrigins = [
  'https://matup.app',
  'https://www.matup.app',
  env.frontendUrl,
].filter(Boolean);
const allowedOrigins = env.nodeEnv === 'production' ? prodOrigins : devOrigins;

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Body parsing
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/email', emailRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

export default app;
