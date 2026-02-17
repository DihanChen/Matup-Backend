import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { gzipJsonResponses } from './middleware/compression';
import emailRoutes from './routes/email';
import leagueRoutes from './routes/leagues';
import leagueFixturesRoutes from './routes/league-fixtures';
import leagueInvitesRoutes from './routes/league-invites';
import leagueScheduleRoutes from './routes/league-schedule';
import leagueStandingsRoutes from './routes/league-standings';
import leagueTeamsRoutes from './routes/league-teams';
import fixtureResultsSubmitRoutes from './routes/fixture-results-submit';
import fixtureResultsConfirmRoutes from './routes/fixture-results-confirm';
import fixtureResultsResolveRoutes from './routes/fixture-results-resolve';
import sessionRoutes from './routes/sessions';

const app = express();

// Security middleware
app.use(helmet());

// CORS - allow frontend
const devOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const prodOrigins = env.corsAllowedOrigins;
const allowedOrigins = env.nodeEnv === 'production' ? prodOrigins : devOrigins;

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

// Body parsing
app.use(express.json());
app.use(gzipJsonResponses);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/email', emailRoutes);
app.use('/api/leagues', leagueFixturesRoutes);
app.use('/api/leagues', leagueInvitesRoutes);
app.use('/api/leagues', leagueScheduleRoutes);
app.use('/api/leagues', leagueStandingsRoutes);
app.use('/api/leagues', leagueTeamsRoutes);
app.use('/api/leagues', leagueRoutes);
app.use('/api/fixtures', fixtureResultsSubmitRoutes);
app.use('/api/fixtures', fixtureResultsConfirmRoutes);
app.use('/api/fixtures', fixtureResultsResolveRoutes);
app.use('/api/sessions', sessionRoutes);

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
