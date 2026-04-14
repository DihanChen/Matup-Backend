import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';

const router: Router = Router();

/**
 * GET /api/users/me/upcoming-fixtures
 * Returns the authenticated user's upcoming fixtures across all leagues,
 * including league name, court info, and pending action flags.
 */
router.get('/me/upcoming-fixtures', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthenticatedRequest;

    // Get all leagues the user belongs to
    const { data: memberships, error: memberError } = await supabaseAdmin
      .from('league_members')
      .select('league_id')
      .eq('user_id', userId);

    if (memberError) {
      res.status(500).json({ error: memberError.message });
      return;
    }

    if (!memberships || memberships.length === 0) {
      res.json({ fixtures: [] });
      return;
    }

    const leagueIds = memberships.map((m) => m.league_id);

    // Get league details
    const { data: leagues } = await supabaseAdmin
      .from('leagues')
      .select('id, name, sport_type')
      .in('id', leagueIds);

    const leagueMap = new Map(
      (leagues || []).map((l) => [l.id, { name: l.name, sport_type: l.sport_type }])
    );

    // Get upcoming fixtures for these leagues (not finalized or cancelled)
    const { data: fixtures, error: fixtureError } = await supabaseAdmin
      .from('league_fixtures')
      .select('id, league_id, week_number, fixture_type, starts_at, ends_at, status, court_id, metadata')
      .in('league_id', leagueIds)
      .in('status', ['scheduled', 'submitted', 'confirmed', 'disputed'])
      .order('starts_at', { ascending: true, nullsFirst: false })
      .limit(50);

    if (fixtureError) {
      res.status(500).json({ error: fixtureError.message });
      return;
    }

    if (!fixtures || fixtures.length === 0) {
      res.json({ fixtures: [] });
      return;
    }

    const fixtureIds = fixtures.map((f) => f.id);

    // Get participants for these fixtures
    const { data: participants } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('fixture_id, user_id, side')
      .in('fixture_id', fixtureIds);

    // Filter to fixtures where user is a participant (for racket sports)
    // or all fixtures in running leagues
    const participantsByFixture = new Map<string, Array<{ user_id: string; side: string }>>();
    (participants || []).forEach((p) => {
      const current = participantsByFixture.get(p.fixture_id) || [];
      current.push({ user_id: p.user_id, side: p.side });
      participantsByFixture.set(p.fixture_id, current);
    });

    // Get pending submissions that need the user's confirmation
    const { data: pendingSubmissions } = await supabaseAdmin
      .from('result_submissions')
      .select('id, fixture_id, submitted_by')
      .in('fixture_id', fixtureIds)
      .eq('status', 'pending')
      .neq('submitted_by', userId);

    const pendingByFixture = new Map<string, string>();
    (pendingSubmissions || []).forEach((s) => {
      pendingByFixture.set(s.fixture_id, s.id);
    });

    // Get court details
    const courtIds = [...new Set(fixtures.map((f) => f.court_id).filter(Boolean))] as string[];
    const courtMap = new Map<string, { id: string; name: string; address: string | null }>();
    if (courtIds.length > 0) {
      const { data: courts } = await supabaseAdmin
        .from('courts')
        .select('id, name, address')
        .in('id', courtIds);

      (courts || []).forEach((c) => {
        courtMap.set(c.id, { id: c.id, name: c.name, address: c.address });
      });
    }

    // Get profile names for opponents
    const allParticipantIds = new Set<string>();
    participantsByFixture.forEach((parts) => {
      parts.forEach((p) => {
        if (p.user_id !== userId) allParticipantIds.add(p.user_id);
      });
    });

    const profileMap = new Map<string, string>();
    if (allParticipantIds.size > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, name')
        .in('id', [...allParticipantIds]);

      (profiles || []).forEach((p) => {
        if (p.name) profileMap.set(p.id, p.name);
      });
    }

    // Build response — include fixtures where user is a participant or it's a running session
    const result = fixtures
      .filter((f) => {
        if (f.fixture_type === 'time_trial_session') return true;
        const parts = participantsByFixture.get(f.id) || [];
        return parts.some((p) => p.user_id === userId);
      })
      .map((f) => {
        const league = leagueMap.get(f.league_id);
        const parts = participantsByFixture.get(f.id) || [];
        const opponents = parts
          .filter((p) => p.user_id !== userId)
          .map((p) => ({
            userId: p.user_id,
            name: profileMap.get(p.user_id) || 'Unknown',
            side: p.side,
          }));

        return {
          id: f.id,
          leagueId: f.league_id,
          leagueName: league?.name || null,
          sportType: league?.sport_type || null,
          weekNumber: f.week_number,
          fixtureType: f.fixture_type,
          startsAt: f.starts_at,
          endsAt: f.ends_at,
          status: f.status,
          court: f.court_id ? courtMap.get(f.court_id) || null : null,
          opponents,
          pendingSubmissionId: pendingByFixture.get(f.id) || null,
          needsAction: pendingByFixture.has(f.id) || f.status === 'disputed',
        };
      });

    res.json({ fixtures: result });
  } catch (error) {
    console.error('Upcoming fixtures fetch error:', error);
    res.status(500).json({ error: 'Failed to load upcoming fixtures' });
  }
});

export default router;
