import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { supabaseAdmin } from '../utils/supabase';

const router: Router = Router();

/**
 * GET /api/leagues/:id/availability
 * Returns availability for all members across all weeks (or a specific week).
 */
router.get('/:id/availability', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const weekQuery = req.query.week;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to view availability' });
      return;
    }

    let query = supabaseAdmin
      .from('league_availability')
      .select('id, user_id, week_number, status, note, updated_at')
      .eq('league_id', leagueId)
      .order('week_number', { ascending: true });

    if (typeof weekQuery === 'string' && weekQuery.trim() !== '') {
      const weekNumber = parseInt(weekQuery, 10);
      if (Number.isFinite(weekNumber)) {
        query = query.eq('week_number', weekNumber);
      }
    }

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Get profile names
    const userIds = [...new Set((data || []).map((a) => a.user_id))];
    let profileMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, name')
        .in('id', userIds);
      profileMap = new Map((profiles || []).map((p) => [p.id, p.name || 'Unknown']));
    }

    const availability = (data || []).map((a) => ({
      ...a,
      user_name: profileMap.get(a.user_id) || 'Unknown',
    }));

    res.json({ availability });
  } catch (error) {
    console.error('Availability fetch error:', error);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

/**
 * PUT /api/leagues/:id/availability
 * Set the current user's availability for a specific week.
 * Body: { week_number, status, note? }
 */
router.put('/:id/availability', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const weekNumber = typeof req.body?.week_number === 'number' ? req.body.week_number : null;
    const status = typeof req.body?.status === 'string' ? req.body.status : null;
    const note = typeof req.body?.note === 'string' ? req.body.note : null;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    if (!weekNumber || !Number.isFinite(weekNumber) || weekNumber < 1) {
      res.status(400).json({ error: 'Valid week_number is required' });
      return;
    }

    const validStatuses = ['available', 'unavailable', 'maybe', 'unknown'];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to set availability' });
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('league_availability')
      .upsert(
        {
          league_id: leagueId,
          user_id: userId,
          week_number: weekNumber,
          status,
          note,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'league_id,user_id,week_number' }
      )
      .select('id, user_id, week_number, status, note, updated_at')
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true, availability: data });
  } catch (error) {
    console.error('Availability update error:', error);
    res.status(500).json({ error: 'Failed to update availability' });
  }
});

/**
 * GET /api/leagues/:id/availability/summary
 * Returns a summary of availability per week (for organizers).
 * Includes counts of available/unavailable/maybe/no-response per week.
 */
router.get('/:id/availability/summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only organizers can view availability summary' });
      return;
    }

    // Get member count
    const { count: memberCount } = await supabaseAdmin
      .from('league_members')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId);

    const totalMembers = memberCount || 0;

    // Get all availability entries
    const { data, error } = await supabaseAdmin
      .from('league_availability')
      .select('week_number, status')
      .eq('league_id', leagueId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Aggregate by week
    const weekMap = new Map<number, { available: number; unavailable: number; maybe: number }>();
    for (const entry of data || []) {
      const current = weekMap.get(entry.week_number) || { available: 0, unavailable: 0, maybe: 0 };
      if (entry.status === 'available') current.available++;
      else if (entry.status === 'unavailable') current.unavailable++;
      else if (entry.status === 'maybe') current.maybe++;
      weekMap.set(entry.week_number, current);
    }

    const summary = [...weekMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([week, counts]) => ({
        week_number: week,
        available: counts.available,
        unavailable: counts.unavailable,
        maybe: counts.maybe,
        no_response: totalMembers - counts.available - counts.unavailable - counts.maybe,
        total_members: totalMembers,
      }));

    res.json({ summary });
  } catch (error) {
    console.error('Availability summary error:', error);
    res.status(500).json({ error: 'Failed to load availability summary' });
  }
});

export default router;
