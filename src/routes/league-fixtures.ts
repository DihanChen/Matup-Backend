import { Request, Response, Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeagueRole } from '../utils/league-access';
import { supabaseAdmin } from '../utils/supabase';

const router = Router();

router.get('/:id/fixtures', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const weekQuery = req.query.week;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }
    const weekNumber =
      typeof weekQuery === 'string' && weekQuery.trim() !== ''
        ? parseInt(weekQuery, 10)
        : null;

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to view fixtures' });
      return;
    }

    let fixtureQuery = supabaseAdmin
      .from('league_fixtures')
      .select(
        'id, week_number, starts_at, ends_at, fixture_type, status, metadata, created_at, updated_at'
      )
      .eq('league_id', leagueId)
      .order('week_number', { ascending: true })
      .order('created_at', { ascending: true });

    if (weekNumber && Number.isFinite(weekNumber)) {
      fixtureQuery = fixtureQuery.eq('week_number', weekNumber);
    }

    const { data: fixtures, error: fixturesError } = await fixtureQuery;
    if (fixturesError) {
      res.status(500).json({ error: fixturesError.message });
      return;
    }

    const fixtureIds = (fixtures || []).map((f) => f.id);
    if (fixtureIds.length === 0) {
      res.json({ fixtures: [] });
      return;
    }

    const { data: participants } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('fixture_id, user_id, side, role')
      .in('fixture_id', fixtureIds);

    const participantIds = [...new Set((participants || []).map((p) => p.user_id))];
    let profiles: Array<{ id: string; name: string | null; avatar_url: string | null }> = [];
    if (participantIds.length > 0) {
      const { data: profileRows } = await supabaseAdmin
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', participantIds);
      profiles = (profileRows || []) as Array<{
        id: string;
        name: string | null;
        avatar_url: string | null;
      }>;
    }

    const { data: submissions } = await supabaseAdmin
      .from('result_submissions')
      .select('id, fixture_id, submitted_by, source, status, payload, submitted_at')
      .in('fixture_id', fixtureIds)
      .order('submitted_at', { ascending: false });

    const { data: checkins } = await supabaseAdmin
      .from('fixture_checkins')
      .select('fixture_id')
      .in('fixture_id', fixtureIds);

    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const participantMap = new Map<string, Array<Record<string, unknown>>>();
    const latestSubmissionMap = new Map<string, Record<string, unknown>>();
    const checkinCountMap = new Map<string, number>();

    (participants || []).forEach((participant) => {
      const current = participantMap.get(participant.fixture_id) || [];
      const profile = profileMap.get(participant.user_id);
      current.push({
        ...participant,
        name: profile?.name || null,
        avatar_url: profile?.avatar_url || null,
      });
      participantMap.set(participant.fixture_id, current);
    });

    (submissions || []).forEach((submission) => {
      if (!latestSubmissionMap.has(submission.fixture_id)) {
        latestSubmissionMap.set(submission.fixture_id, submission as Record<string, unknown>);
      }
    });

    (checkins || []).forEach((checkin) => {
      checkinCountMap.set(
        checkin.fixture_id,
        (checkinCountMap.get(checkin.fixture_id) || 0) + 1
      );
    });

    const response = (fixtures || []).map((fixture) => ({
      ...fixture,
      participants: participantMap.get(fixture.id) || [],
      latest_submission: latestSubmissionMap.get(fixture.id) || null,
      checkins_count: checkinCountMap.get(fixture.id) || 0,
    }));

    res.json({ fixtures: response });
  } catch (error) {
    console.error('Fixtures fetch error:', error);
    res.status(500).json({ error: 'Failed to load fixtures' });
  }
});

export default router;
