import { Request, Response, Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeagueRole } from '../utils/league-access';
import {
  LeagueStandingsLoadError,
  loadLeagueStandings,
} from '../services/league-standings-read.service';

const router = Router();

router.get('/:id/standings', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to view standings' });
      return;
    }

    const payload = await loadLeagueStandings(leagueId);
    if (!payload) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    res.json(payload);
  } catch (error) {
    if (error instanceof LeagueStandingsLoadError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    console.error('Standings fetch error:', error);
    res.status(500).json({ error: 'Failed to load standings' });
  }
});

export default router;
