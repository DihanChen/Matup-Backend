import { Request, Response, Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { getLeague } from '../services/league.service';
import { toIsoOrNull, weekEndIso } from '../utils/league-dates';

const router = Router();

router.get('/:id/sessions', requireAuth, async (req: Request, res: Response) => {
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
      res.status(403).json({ error: 'You must be a league member to view sessions' });
      return;
    }

    const weekNumber =
      typeof weekQuery === 'string' && weekQuery.trim() !== ''
        ? parseInt(weekQuery, 10)
        : null;

    let sessionQuery = supabaseAdmin
      .from('running_sessions')
      .select(
        'id, league_id, week_number, session_type, distance_meters, route_name, starts_at, submission_deadline, comparison_mode, status, created_at, updated_at'
      )
      .eq('league_id', leagueId)
      .order('week_number', { ascending: true })
      .order('created_at', { ascending: true });

    if (weekNumber && Number.isFinite(weekNumber)) {
      sessionQuery = sessionQuery.eq('week_number', weekNumber);
    }

    const { data: sessions, error: sessionError } = await sessionQuery;
    if (sessionError) {
      res.status(500).json({ error: sessionError.message });
      return;
    }

    const sessionIds = (sessions || []).map((session) => session.id);
    if (sessionIds.length === 0) {
      res.json({ sessions: [] });
      return;
    }

    const { data: runs, error: runError } = await supabaseAdmin
      .from('session_runs')
      .select(
        'id, session_id, user_id, elapsed_seconds, distance_meters, proof_url, status, submitted_at, reviewed_by, reviewed_at, review_note'
      )
      .in('session_id', sessionIds)
      .order('submitted_at', { ascending: true });

    if (runError) {
      res.status(500).json({ error: runError.message });
      return;
    }

    const runUserIds = [...new Set((runs || []).map((run) => run.user_id))];
    const { data: profiles } = runUserIds.length
      ? await supabaseAdmin
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', runUserIds)
      : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }> };

    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const runsBySession = new Map<string, Array<Record<string, unknown>>>();

    (runs || []).forEach((run) => {
      const profile = profileMap.get(run.user_id);
      const current = runsBySession.get(run.session_id) || [];
      current.push({
        ...run,
        name: profile?.name || null,
        avatar_url: profile?.avatar_url || null,
      });
      runsBySession.set(run.session_id, current);
    });

    const response = (sessions || []).map((session) => {
      const sessionRuns = runsBySession.get(session.id) || [];
      const myRun =
        sessionRuns.find(
          (run) => typeof run.user_id === 'string' && run.user_id === userId
        ) || null;

      return {
        ...session,
        runs: sessionRuns,
        my_run: myRun,
      };
    });

    res.json({ sessions: response });
  } catch (error) {
    console.error('Running sessions fetch error:', error);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

router.post('/:id/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const weekNumber = Number.parseInt(String(req.body?.weekNumber || ''), 10);
    const sessionType =
      req.body?.sessionType === 'group_run' || req.body?.sessionType === 'interval'
        ? req.body.sessionType
        : 'time_trial';
    const comparisonMode =
      req.body?.comparisonMode === 'absolute_performance'
        ? 'absolute_performance'
        : 'personal_progress';
    const status =
      req.body?.status === 'open' ||
      req.body?.status === 'closed' ||
      req.body?.status === 'finalized'
        ? req.body.status
        : 'scheduled';
    const startsAt = toIsoOrNull(req.body?.startsAt);
    const submissionDeadline = toIsoOrNull(req.body?.submissionDeadline);
    const distanceMeters =
      typeof req.body?.distanceMeters === 'number' &&
      Number.isFinite(req.body.distanceMeters) &&
      req.body.distanceMeters > 0
        ? Math.round(req.body.distanceMeters)
        : null;
    const routeName =
      typeof req.body?.routeName === 'string' && req.body.routeName.trim() !== ''
        ? req.body.routeName.trim()
        : null;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    if (!Number.isFinite(weekNumber) || weekNumber < 1) {
      res.status(400).json({ error: 'weekNumber must be a positive integer' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can manage sessions' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }
    if (league.sport_type !== 'running') {
      res.status(400).json({ error: 'Session management is only supported for running leagues' });
      return;
    }

    const { data: session, error: sessionError } = await supabaseAdmin
      .from('running_sessions')
      .upsert(
        {
          league_id: leagueId,
          week_number: weekNumber,
          session_type: sessionType,
          distance_meters: distanceMeters,
          route_name: routeName,
          starts_at: startsAt,
          submission_deadline: submissionDeadline,
          comparison_mode: comparisonMode,
          status,
          created_by: userId,
        },
        {
          onConflict: 'league_id,week_number',
        }
      )
      .select(
        'id, league_id, week_number, session_type, distance_meters, route_name, starts_at, submission_deadline, comparison_mode, status, created_at, updated_at'
      )
      .single();

    if (sessionError || !session) {
      res.status(500).json({ error: sessionError?.message || 'Failed to save session' });
      return;
    }

    const fixtureEndsAt = submissionDeadline || weekEndIso(startsAt);
    const { data: existingFixture } = await supabaseAdmin
      .from('league_fixtures')
      .select('id')
      .eq('league_id', leagueId)
      .eq('week_number', weekNumber)
      .eq('fixture_type', 'time_trial_session')
      .limit(1)
      .maybeSingle();

    if (existingFixture?.id) {
      await supabaseAdmin
        .from('league_fixtures')
        .update({
          starts_at: startsAt,
          ends_at: fixtureEndsAt,
          status: status === 'finalized' ? 'finalized' : 'scheduled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingFixture.id);
    } else {
      await supabaseAdmin.from('league_fixtures').insert({
        league_id: leagueId,
        week_number: weekNumber,
        starts_at: startsAt,
        ends_at: fixtureEndsAt,
        fixture_type: 'time_trial_session',
        status: status === 'finalized' ? 'finalized' : 'scheduled',
        metadata: {
          generated: false,
          sport: 'running',
          source: 'manual_session',
        },
        created_by: userId,
      });
    }

    res.json({ success: true, session });
  } catch (error) {
    console.error('Running session save error:', error);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

export default router;
