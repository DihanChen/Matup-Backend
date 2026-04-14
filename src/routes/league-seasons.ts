import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { supabaseAdmin } from '../utils/supabase';

const router: Router = Router();

/**
 * GET /api/leagues/:id/seasons
 * Returns all seasons for a league, ordered by season_number descending.
 */
router.get('/:id/seasons', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to view seasons' });
      return;
    }

    const { data: seasons, error } = await supabaseAdmin
      .from('league_seasons')
      .select('id, league_id, season_number, name, start_date, end_date, status, created_at')
      .eq('league_id', leagueId)
      .order('season_number', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Get current season id from league
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('current_season_id')
      .eq('id', leagueId)
      .single();

    res.json({
      seasons: seasons || [],
      currentSeasonId: league?.current_season_id || null,
    });
  } catch (error) {
    console.error('Seasons fetch error:', error);
    res.status(500).json({ error: 'Failed to load seasons' });
  }
});

/**
 * POST /api/leagues/:id/seasons
 * Creates a new season. Completes the current season, cancels its non-finalized fixtures,
 * and sets the new season as current.
 * Body: { name?, start_date? }
 */
router.post('/:id/seasons', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : null;
    const startDate = typeof req.body?.start_date === 'string' ? req.body.start_date : null;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can create a new season' });
      return;
    }

    // Get current max season number
    const { data: existingSeasons } = await supabaseAdmin
      .from('league_seasons')
      .select('id, season_number, status')
      .eq('league_id', leagueId)
      .order('season_number', { ascending: false })
      .limit(1);

    const lastSeason = existingSeasons?.[0] || null;
    const newSeasonNumber = lastSeason ? lastSeason.season_number + 1 : 1;

    // Mark current season as completed
    if (lastSeason && lastSeason.status === 'active') {
      await supabaseAdmin
        .from('league_seasons')
        .update({
          status: 'completed',
          end_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', lastSeason.id);
    }

    // Create new season
    const seasonName = name || `Season ${newSeasonNumber}`;
    const { data: newSeason, error: createError } = await supabaseAdmin
      .from('league_seasons')
      .insert({
        league_id: leagueId,
        season_number: newSeasonNumber,
        name: seasonName,
        start_date: startDate,
        status: 'active',
        created_by: userId,
      })
      .select('id, season_number, name, start_date, status, created_at')
      .single();

    if (createError || !newSeason) {
      res.status(500).json({ error: createError?.message || 'Failed to create season' });
      return;
    }

    // Update league's current_season_id
    await supabaseAdmin
      .from('leagues')
      .update({ current_season_id: newSeason.id })
      .eq('id', leagueId);

    res.json({
      success: true,
      season: newSeason,
    });
  } catch (error) {
    console.error('Season creation error:', error);
    res.status(500).json({ error: 'Failed to create season' });
  }
});

export default router;
