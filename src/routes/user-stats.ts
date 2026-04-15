import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';

const router: Router = Router();

type MatchHistoryRow = {
  fixture_id: string;
  league_id: string;
  league_name: string;
  week_number: number | null;
  starts_at: string | null;
  status: string;
  user_side: string;
  winner: string | null;
  sets: number[][] | null;
  opponent_names: string[];
};

/**
 * GET /api/users/me/match-history
 * Returns finalized matches for the authenticated user across all leagues.
 */
router.get('/me/match-history', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthenticatedRequest;

    // Get all fixture IDs the user participated in
    const { data: participations, error: partError } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('fixture_id, side')
      .eq('user_id', userId);

    if (partError) {
      res.status(500).json({ error: partError.message });
      return;
    }

    if (!participations || participations.length === 0) {
      res.json({ matches: [], stats: { played: 0, won: 0, lost: 0, winRate: 0 } });
      return;
    }

    const fixtureIds = participations.map((p) => p.fixture_id);
    const userSideMap = new Map(participations.map((p) => [p.fixture_id, p.side]));

    // Get finalized fixtures
    const { data: fixtures } = await supabaseAdmin
      .from('league_fixtures')
      .select('id, league_id, week_number, starts_at, status, metadata')
      .in('id', fixtureIds)
      .eq('status', 'finalized')
      .order('starts_at', { ascending: false, nullsFirst: false })
      .limit(100);

    if (!fixtures || fixtures.length === 0) {
      res.json({ matches: [], stats: { played: 0, won: 0, lost: 0, winRate: 0 } });
      return;
    }

    // Get league names
    const leagueIds = [...new Set(fixtures.map((f) => f.league_id))];
    const { data: leagues } = await supabaseAdmin
      .from('leagues')
      .select('id, name')
      .in('id', leagueIds);

    const leagueMap = new Map((leagues || []).map((l) => [l.id, l.name]));

    // Get all participants for these fixtures
    const fIds = fixtures.map((f) => f.id);
    const { data: allParticipants } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('fixture_id, user_id, side')
      .in('fixture_id', fIds);

    // Get profile names
    const opponentIds = new Set<string>();
    (allParticipants || []).forEach((p) => {
      if (p.user_id !== userId) opponentIds.add(p.user_id);
    });

    const profileMap = new Map<string, string>();
    if (opponentIds.size > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, name')
        .in('id', [...opponentIds]);

      (profiles || []).forEach((p) => {
        if (p.name) profileMap.set(p.id, p.name);
      });
    }

    // Build participant index by fixture
    const participantsByFixture = new Map<string, Array<{ user_id: string; side: string }>>();
    (allParticipants || []).forEach((p) => {
      const current = participantsByFixture.get(p.fixture_id) || [];
      current.push({ user_id: p.user_id, side: p.side });
      participantsByFixture.set(p.fixture_id, current);
    });

    let won = 0;
    let lost = 0;

    const matches: MatchHistoryRow[] = fixtures.map((f) => {
      const metadata = f.metadata as Record<string, unknown> | null;
      const finalResult = metadata?.final_result as Record<string, unknown> | undefined;
      const winner = typeof finalResult?.winner === 'string' ? finalResult.winner : null;
      const sets = Array.isArray(finalResult?.sets) ? (finalResult.sets as number[][]) : null;

      const userSide = userSideMap.get(f.id) || 'A';
      const parts = participantsByFixture.get(f.id) || [];
      const opponents = parts
        .filter((p) => p.user_id !== userId)
        .map((p) => profileMap.get(p.user_id) || 'Unknown');

      if (winner === userSide) won++;
      else if (winner) lost++;

      return {
        fixture_id: f.id,
        league_id: f.league_id,
        league_name: leagueMap.get(f.league_id) || 'Unknown League',
        week_number: f.week_number,
        starts_at: f.starts_at,
        status: f.status,
        user_side: userSide,
        winner,
        sets,
        opponent_names: opponents,
      };
    });

    const played = matches.length;
    const winRate = played > 0 ? Math.round((won / played) * 100) : 0;

    res.json({
      matches,
      stats: { played, won, lost, winRate },
    });
  } catch (error) {
    console.error('Match history fetch error:', error);
    res.status(500).json({ error: 'Failed to load match history' });
  }
});

/**
 * GET /api/users/me/head-to-head/:opponentId
 * Returns H2H record against a specific opponent.
 */
router.get('/me/head-to-head/:opponentId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req as AuthenticatedRequest;
    const opponentId = Array.isArray(req.params.opponentId)
      ? req.params.opponentId[0]
      : req.params.opponentId;

    if (!opponentId) {
      res.status(400).json({ error: 'opponentId is required' });
      return;
    }

    // Find fixtures where both users participated
    const { data: userFixtures } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('fixture_id, side')
      .eq('user_id', userId);

    const { data: opponentFixtures } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('fixture_id, side')
      .eq('user_id', opponentId);

    const userFixtureIds = new Set((userFixtures || []).map((f) => f.fixture_id));
    const commonFixtureIds = (opponentFixtures || [])
      .filter((f) => userFixtureIds.has(f.fixture_id))
      .map((f) => f.fixture_id);

    if (commonFixtureIds.length === 0) {
      res.json({ wins: 0, losses: 0, draws: 0, matches: [] });
      return;
    }

    const userSideMap = new Map((userFixtures || []).map((f) => [f.fixture_id, f.side]));

    // Get finalized fixtures
    const { data: fixtures } = await supabaseAdmin
      .from('league_fixtures')
      .select('id, league_id, week_number, starts_at, metadata')
      .in('id', commonFixtureIds)
      .eq('status', 'finalized')
      .order('starts_at', { ascending: false, nullsFirst: false });

    let wins = 0;
    let losses = 0;
    let draws = 0;

    const matchSummaries = (fixtures || []).map((f) => {
      const metadata = f.metadata as Record<string, unknown> | null;
      const finalResult = metadata?.final_result as Record<string, unknown> | undefined;
      const winner = typeof finalResult?.winner === 'string' ? finalResult.winner : null;
      const sets = Array.isArray(finalResult?.sets) ? (finalResult.sets as number[][]) : null;
      const userSide = userSideMap.get(f.id) || 'A';

      if (winner === userSide) wins++;
      else if (winner) losses++;
      else draws++;

      return {
        fixture_id: f.id,
        league_id: f.league_id,
        week_number: f.week_number,
        starts_at: f.starts_at,
        user_side: userSide,
        winner,
        sets,
      };
    });

    res.json({ wins, losses, draws, matches: matchSummaries });
  } catch (error) {
    console.error('Head-to-head fetch error:', error);
    res.status(500).json({ error: 'Failed to load head-to-head record' });
  }
});

export default router;
