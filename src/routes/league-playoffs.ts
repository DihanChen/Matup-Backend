import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { getLeague } from '../services/league.service';
import { supabaseAdmin } from '../utils/supabase';
import {
  loadLeagueStandings,
  LeagueStandingsLoadError,
} from '../services/league-standings-read.service';
import {
  generateSingleEliminationSchedule,
  getTotalRounds,
} from '../services/tournament-schedule.service';

const router: Router = Router();

/**
 * POST /api/leagues/:id/playoffs/generate
 * Generates a single-elimination playoff bracket from the current standings.
 * Body: { top_n?: number } — how many players from standings to seed (default: 8)
 */
router.post('/:id/playoffs/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can generate playoffs' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    // Check that no playoff fixtures already exist
    const { count: existingPlayoffs } = await supabaseAdmin
      .from('league_fixtures')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .eq('fixture_type', 'tournament_match')
      .neq('status', 'cancelled');

    if ((existingPlayoffs || 0) > 0) {
      res.status(409).json({
        error: 'Playoff bracket already exists. Cancel existing playoff fixtures first.',
      });
      return;
    }

    // Load current standings
    let standingsPayload: Awaited<ReturnType<typeof loadLeagueStandings>> = null;
    try {
      standingsPayload = await loadLeagueStandings(leagueId);
    } catch (loadError) {
      if (loadError instanceof LeagueStandingsLoadError) {
        res.status(loadError.statusCode).json({ error: loadError.message });
        return;
      }
      throw loadError;
    }

    if (!standingsPayload) {
      res.status(400).json({ error: 'Could not load standings for this league' });
      return;
    }

    const standings = standingsPayload.standings;
    if (standings.length < 2) {
      res.status(400).json({ error: 'Need at least 2 players in standings to generate playoffs' });
      return;
    }

    // Determine top N
    const topN = typeof req.body?.top_n === 'number' && req.body.top_n >= 2
      ? Math.min(req.body.top_n, standings.length)
      : Math.min(8, standings.length);

    // Sort by rank and take top N
    const seeded = [...standings]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, topN);

    const seededIds = seeded.map((s) => s.user_id);

    // Generate bracket with seeded order (rank 1 = seed 1, etc.)
    const bracketFixtures = generateSingleEliminationSchedule(seededIds, 'manual', seededIds);

    if (bracketFixtures.length === 0) {
      res.status(400).json({ error: 'Could not generate playoff bracket' });
      return;
    }

    const totalRounds = getTotalRounds(seededIds.length);
    const courtId = league.default_court_id || null;

    // Create fixtures
    const createdFixtureIds = new Map<number, string>();
    let createdFixtures = 0;
    let createdParticipants = 0;

    for (const entry of bracketFixtures) {
      const roundLabel = entry.round === totalRounds ? 'Final' :
        entry.round === totalRounds - 1 ? 'Semi-Final' : `Playoff Round ${entry.round}`;

      const { data: fixture, error: fixtureError } = await supabaseAdmin
        .from('league_fixtures')
        .insert({
          league_id: leagueId,
          week_number: null,
          fixture_type: 'tournament_match',
          status: entry.isBye ? 'finalized' :
            (entry.sideA.length > 0 && entry.sideB.length > 0) ? 'scheduled' : 'pending_participants',
          court_id: courtId,
          metadata: {
            generated: true,
            sport: league.sport_type,
            scoring_format: league.scoring_format,
            tournament: true,
            playoff: true,
            round: entry.round,
            match_number: entry.matchNumber,
            round_label: roundLabel,
            total_rounds: totalRounds,
            is_bye: entry.isBye,
            ...(entry.isBye && (entry.sideA.length > 0 || entry.sideB.length > 0)
              ? { final_result: { winner: entry.sideA.length > 0 ? 'A' : 'B', bye: true } }
              : {}),
          },
          created_by: userId,
        })
        .select('id')
        .single();

      if (fixtureError || !fixture) {
        res.status(500).json({ error: fixtureError?.message || 'Failed to create playoff fixture' });
        return;
      }

      createdFixtureIds.set(entry.matchNumber, fixture.id);
      createdFixtures++;

      const participantRows = [
        ...entry.sideA.map((playerId) => ({
          fixture_id: fixture.id,
          user_id: playerId,
          side: 'A',
          role: 'player',
        })),
        ...entry.sideB.map((playerId) => ({
          fixture_id: fixture.id,
          user_id: playerId,
          side: 'B',
          role: 'player',
        })),
      ];

      if (participantRows.length > 0) {
        const { error: participantError } = await supabaseAdmin
          .from('league_fixture_participants')
          .insert(participantRows);

        if (participantError) {
          res.status(500).json({ error: participantError.message });
          return;
        }
        createdParticipants += participantRows.length;
      }
    }

    // Link fixtures with next_fixture_id and handle bye advances
    for (const entry of bracketFixtures) {
      if (entry.round >= totalRounds) continue;

      const matchesBeforeThisRound = bracketFixtures
        .filter((f) => f.round < entry.round)
        .length;
      const indexInRound = entry.matchNumber - matchesBeforeThisRound - 1;
      const nextRoundMatchIndex = Math.floor(indexInRound / 2);
      const bracketSlot = indexInRound % 2 === 0 ? 'A' : 'B';

      const nextRoundFixtures = bracketFixtures.filter((f) => f.round === entry.round + 1);
      if (nextRoundMatchIndex >= nextRoundFixtures.length) continue;
      const nextMatchNumber = nextRoundFixtures[nextRoundMatchIndex].matchNumber;
      const nextFixtureId = createdFixtureIds.get(nextMatchNumber);

      if (!nextFixtureId) continue;

      const currentFixtureId = createdFixtureIds.get(entry.matchNumber);
      if (!currentFixtureId) continue;

      const { data: currentFixture } = await supabaseAdmin
        .from('league_fixtures')
        .select('metadata')
        .eq('id', currentFixtureId)
        .single();

      const existingMeta = (currentFixture?.metadata as Record<string, unknown>) || {};
      await supabaseAdmin
        .from('league_fixtures')
        .update({
          metadata: {
            ...existingMeta,
            next_fixture_id: nextFixtureId,
            bracket_slot: bracketSlot,
          },
        })
        .eq('id', currentFixtureId);

      if (entry.isBye) {
        const byeWinner = entry.sideA.length > 0 ? entry.sideA : entry.sideB;
        if (byeWinner.length > 0) {
          const advanceRows = byeWinner.map((playerId) => ({
            fixture_id: nextFixtureId,
            user_id: playerId,
            side: bracketSlot,
            role: 'player',
          }));

          await supabaseAdmin
            .from('league_fixture_participants')
            .insert(advanceRows);
          createdParticipants += advanceRows.length;

          const { data: nextParts } = await supabaseAdmin
            .from('league_fixture_participants')
            .select('side')
            .eq('fixture_id', nextFixtureId);

          const sides = new Set((nextParts || []).map((p) => p.side));
          if (sides.has('A') && sides.has('B')) {
            await supabaseAdmin
              .from('league_fixtures')
              .update({ status: 'scheduled' })
              .eq('id', nextFixtureId)
              .eq('status', 'pending_participants');
          }
        }
      }
    }

    res.json({
      success: true,
      playoffPlayers: topN,
      totalRounds,
      createdFixtures,
      createdParticipants,
      seeding: seeded.map((s, i) => ({ seed: i + 1, user_id: s.user_id, name: s.name })),
    });
  } catch (error) {
    console.error('Playoff generation error:', error);
    res.status(500).json({ error: 'Failed to generate playoffs' });
  }
});

export default router;
