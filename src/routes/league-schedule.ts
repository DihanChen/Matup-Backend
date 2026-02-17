import { Request, Response, Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import { getLeague } from '../services/league.service';
import { supabaseAdmin } from '../utils/supabase';
import { getNestedNumber, getNestedString, toRulesObject } from '../utils/rules';
import {
  generateSinglesSchedule,
  generateDoublesAssignedSchedule,
  generateDoublesRandomSchedule,
} from '../services/fixture-schedule.service';
import { getConfiguredFixedPairs } from '../services/league-rules.service';
import { weekEndIso, weekStartIso } from '../utils/league-dates';

const router = Router();

router.post('/:id/schedule/generate', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can generate schedule' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const rules = toRulesObject(league.rules_jsonb);
    const ruleWeeks = getNestedNumber(rules, ['schedule', 'season_weeks']);
    const seasonWeeks = ruleWeeks || league.season_weeks || 10;
    const startDate = getNestedString(rules, ['schedule', 'starts_on']) || league.start_date;
    const startTime = getNestedString(rules, ['schedule', 'starts_at_local']);

    const { count: existingFixtures } = await supabaseAdmin
      .from('league_fixtures')
      .select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId)
      .neq('status', 'cancelled');

    if ((existingFixtures || 0) > 0) {
      res.status(409).json({
        error: 'Schedule already exists. Clear existing fixtures before generating again.',
      });
      return;
    }

    const { data: members, error: membersError } = await supabaseAdmin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);

    if (membersError) {
      res.status(500).json({ error: 'Failed to load league members' });
      return;
    }

    const memberIds = (members || []).map((m) => m.user_id).filter(Boolean);
    if (memberIds.length === 0) {
      res.status(400).json({ error: 'League has no members' });
      return;
    }

    if (league.sport_type === 'running') {
      const sessionType =
        getNestedString(rules, ['sessions', 'default_session_type']) || 'time_trial';
      const comparisonMode =
        getNestedString(rules, ['sessions', 'comparison_mode']) || 'personal_progress';

      let createdFixtures = 0;
      let createdSessions = 0;

      for (let week = 1; week <= seasonWeeks; week++) {
        const startsAt = weekStartIso(startDate, week, startTime);
        const endsAt = startsAt ? new Date(startsAt) : null;
        if (endsAt) endsAt.setUTCDate(endsAt.getUTCDate() + 6);

        const { data: fixture, error: fixtureError } = await supabaseAdmin
          .from('league_fixtures')
          .insert({
            league_id: leagueId,
            week_number: week,
            starts_at: startsAt,
            ends_at: weekEndIso(startsAt),
            fixture_type: 'time_trial_session',
            status: 'scheduled',
            metadata: {
              generated: true,
              sport: 'running',
            },
            created_by: userId,
          })
          .select('id')
          .single();

        if (fixtureError || !fixture) {
          res.status(500).json({ error: fixtureError?.message || 'Failed to create fixture' });
          return;
        }
        createdFixtures += 1;

        const { error: runningError } = await supabaseAdmin
          .from('running_sessions')
          .insert({
            league_id: leagueId,
            week_number: week,
            session_type: sessionType,
            starts_at: startsAt,
            submission_deadline: endsAt ? endsAt.toISOString() : null,
            comparison_mode: comparisonMode,
            status: 'scheduled',
            created_by: userId,
          });

        if (runningError) {
          await supabaseAdmin.from('league_fixtures').delete().eq('id', fixture.id);
          res.status(500).json({ error: runningError.message });
          return;
        }

        createdSessions += 1;
      }

      res.json({
        success: true,
        sport: 'running',
        seasonWeeks,
        createdFixtures,
        createdSessions,
      });
      return;
    }

    let schedule;
    if (league.scoring_format === 'singles') {
      if (memberIds.length < 2) {
        res.status(400).json({ error: 'Singles schedule needs at least 2 members' });
        return;
      }
      schedule = generateSinglesSchedule(memberIds, seasonWeeks);
    } else if (league.scoring_format === 'doubles') {
      if (memberIds.length < 4) {
        res.status(400).json({ error: 'Doubles schedule needs at least 4 members' });
        return;
      }
      const partnerMode = getNestedString(rules, ['match', 'doubles_partner_mode']);
      const isAssigned =
        partnerMode === 'fixed_pairs' || league.rotation_type === 'assigned';
      const configuredFixedPairs = getConfiguredFixedPairs(rules, new Set(memberIds));
      if (isAssigned && configuredFixedPairs.length < 2) {
        res.status(400).json({
          error: 'Assigned doubles requires at least 2 fixed teams. Configure teams first.',
        });
        return;
      }
      schedule = isAssigned
        ? generateDoublesAssignedSchedule(memberIds, seasonWeeks, configuredFixedPairs)
        : generateDoublesRandomSchedule(memberIds, seasonWeeks);
    } else {
      res
        .status(400)
        .json({ error: `Scheduling is not supported for ${league.scoring_format}` });
      return;
    }

    let createdFixtures = 0;
    let createdParticipants = 0;

    for (const entry of schedule) {
      const startsAt = weekStartIso(startDate, entry.weekNumber, startTime);
      const { data: fixture, error: fixtureError } = await supabaseAdmin
        .from('league_fixtures')
        .insert({
          league_id: leagueId,
          week_number: entry.weekNumber,
          starts_at: startsAt,
          ends_at: weekEndIso(startsAt),
          fixture_type: 'league_match',
          status: 'scheduled',
          metadata: {
            generated: true,
            sport: league.sport_type,
            scoring_format: league.scoring_format,
          },
          created_by: userId,
        })
        .select('id')
        .single();

      if (fixtureError || !fixture) {
        res.status(500).json({ error: fixtureError?.message || 'Failed to create fixture' });
        return;
      }

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

      const { error: participantError } = await supabaseAdmin
        .from('league_fixture_participants')
        .insert(participantRows);

      if (participantError) {
        await supabaseAdmin.from('league_fixtures').delete().eq('id', fixture.id);
        res.status(500).json({ error: participantError.message });
        return;
      }

      createdFixtures += 1;
      createdParticipants += participantRows.length;
    }

    res.json({
      success: true,
      sport: league.sport_type,
      scoringFormat: league.scoring_format,
      seasonWeeks,
      createdFixtures,
      createdParticipants,
    });
  } catch (error) {
    console.error('Schedule generation error:', error);
    res.status(500).json({ error: 'Failed to generate schedule' });
  }
});

export default router;
