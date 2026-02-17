import { supabaseAdmin } from '../utils/supabase';
import { getNestedString, toRulesObject } from '../utils/rules';
import {
  calculateStandings,
  calculateTeamStandings,
  type RankingMatch,
  type RankingMember,
  type RankingParticipant,
  type RunningComparisonMode,
  type Standing,
  type TeamStanding,
} from './standings.service';

type LeagueStandingsLeagueRow = {
  id: string;
  sport_type: string;
  scoring_format: string;
  rules_jsonb: unknown;
};

type FinalResultPayload = {
  winner?: 'A' | 'B';
  sets?: number[][];
};

type StandingsSources = {
  legacyCompletedMatches: number;
  workflowFinalizedFixtures: number;
  workflowFinalizedSessions: number;
};

export type LeagueStandingsPayload = {
  standings: Standing[];
  teamStandings: TeamStanding[];
  runningMode: RunningComparisonMode | null;
  sources: StandingsSources;
};

export class LeagueStandingsLoadError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getFinalResultFromMetadata(
  metadata: Record<string, unknown> | null
): FinalResultPayload | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const candidate = metadata.final_result;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  const candidateRecord = candidate as Record<string, unknown>;
  const winner =
    candidateRecord.winner === 'A' || candidateRecord.winner === 'B'
      ? candidateRecord.winner
      : undefined;
  const sets = Array.isArray(candidateRecord.sets)
    ? candidateRecord.sets.filter(
        (set): set is number[] =>
          Array.isArray(set) &&
          set.length === 2 &&
          set.every((value) => typeof value === 'number')
      )
    : undefined;

  return {
    winner,
    sets,
  };
}

async function getLeagueForStandings(leagueId: string): Promise<LeagueStandingsLeagueRow | null> {
  const { data, error } = await supabaseAdmin
    .from('leagues')
    .select('id, sport_type, scoring_format, rules_jsonb')
    .eq('id', leagueId)
    .single();

  if (error || !data) return null;
  return data as LeagueStandingsLeagueRow;
}

export async function loadLeagueStandings(
  leagueId: string
): Promise<LeagueStandingsPayload | null> {
  const league = await getLeagueForStandings(leagueId);
  if (!league) return null;

  const rules = toRulesObject(league.rules_jsonb);
  const runningComparisonModeRaw =
    getNestedString(rules, ['sessions', 'comparison_mode']) ||
    getNestedString(rules, ['standings', 'mode']);
  const runningComparisonMode: RunningComparisonMode =
    runningComparisonModeRaw === 'absolute_performance'
      ? 'absolute_performance'
      : 'personal_progress';

  const { data: memberRows, error: memberError } = await supabaseAdmin
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId);

  if (memberError) {
    throw new LeagueStandingsLoadError(500, memberError.message);
  }

  const memberIds = (memberRows || []).map((item) => item.user_id);
  const { data: profiles, error: profileError } = memberIds.length
    ? await supabaseAdmin
        .from('profiles')
        .select('id, name, avatar_url')
        .in('id', memberIds)
    : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }>, error: null };

  if (profileError) {
    throw new LeagueStandingsLoadError(500, profileError.message);
  }

  const profileById = new Map((profiles || []).map((item) => [item.id, item]));
  const rankingMembers: RankingMember[] = memberIds.map((memberId) => {
    const profile = profileById.get(memberId);
    return {
      user_id: memberId,
      name: profile?.name || null,
      avatar_url: profile?.avatar_url || null,
    };
  });

  const rankingMatches: RankingMatch[] = [];
  const rankingParticipants: RankingParticipant[] = [];

  const { data: legacyMatches, error: legacyMatchesError } = await supabaseAdmin
    .from('league_matches')
    .select('id, status, week_number, winner')
    .eq('league_id', leagueId)
    .eq('status', 'completed');

  if (legacyMatchesError) {
    throw new LeagueStandingsLoadError(500, legacyMatchesError.message);
  }

  const legacyMatchIds = (legacyMatches || []).map((match) => match.id);
  if (legacyMatchIds.length > 0) {
    const { data: legacyParticipants, error: legacyParticipantError } = await supabaseAdmin
      .from('match_participants')
      .select('match_id, user_id, team, score, time_seconds, points, set_scores')
      .in('match_id', legacyMatchIds);

    if (legacyParticipantError) {
      throw new LeagueStandingsLoadError(500, legacyParticipantError.message);
    }

    (legacyMatches || []).forEach((match) => {
      rankingMatches.push({
        id: `legacy:${match.id}`,
        status: 'completed',
        week_number: match.week_number,
        winner: match.winner,
      });
    });

    (legacyParticipants || []).forEach((participant) => {
      rankingParticipants.push({
        match_id: `legacy:${participant.match_id}`,
        user_id: participant.user_id,
        team: participant.team,
        score: participant.score,
        time_seconds: participant.time_seconds,
        distance_meters: null,
        points: participant.points,
        set_scores:
          participant.set_scores &&
          typeof participant.set_scores === 'object' &&
          !Array.isArray(participant.set_scores)
            ? (participant.set_scores as { sets: number[][] })
            : null,
      });
    });
  }

  const { data: fixtures, error: fixtureError } = await supabaseAdmin
    .from('league_fixtures')
    .select('id, status, week_number, metadata')
    .eq('league_id', leagueId)
    .eq('status', 'finalized');

  if (fixtureError) {
    throw new LeagueStandingsLoadError(500, fixtureError.message);
  }

  const fixtureIds = (fixtures || []).map((fixture) => fixture.id);
  const fixtureById = new Map((fixtures || []).map((fixture) => [fixture.id, fixture]));
  if (fixtureIds.length > 0) {
    const { data: fixtureParticipants, error: fixtureParticipantError } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('fixture_id, user_id, side')
      .in('fixture_id', fixtureIds);

    if (fixtureParticipantError) {
      throw new LeagueStandingsLoadError(500, fixtureParticipantError.message);
    }

    (fixtures || []).forEach((fixture) => {
      const finalResult = getFinalResultFromMetadata(
        fixture.metadata as Record<string, unknown> | null
      );
      rankingMatches.push({
        id: `workflow:${fixture.id}`,
        status: 'completed',
        week_number: fixture.week_number,
        winner: finalResult?.winner || null,
      });
    });

    (fixtureParticipants || []).forEach((participant) => {
      const fixture = fixtureById.get(participant.fixture_id);
      const finalResult = getFinalResultFromMetadata(
        (fixture?.metadata || null) as Record<string, unknown> | null
      );
      rankingParticipants.push({
        match_id: `workflow:${participant.fixture_id}`,
        user_id: participant.user_id,
        team: participant.side,
        score: null,
        time_seconds: null,
        distance_meters: null,
        points: null,
        set_scores:
          finalResult?.sets && finalResult.sets.length > 0
            ? { sets: finalResult.sets }
            : null,
      });
    });
  }

  let finalizedSessionsCount = 0;
  if (league.sport_type === 'running') {
    const { data: finalizedSessions, error: finalizedSessionsError } = await supabaseAdmin
      .from('running_sessions')
      .select('id, week_number')
      .eq('league_id', leagueId)
      .eq('status', 'finalized');

    if (finalizedSessionsError) {
      throw new LeagueStandingsLoadError(500, finalizedSessionsError.message);
    }

    const sessionIds = (finalizedSessions || []).map((session) => session.id);
    finalizedSessionsCount = sessionIds.length;

    if (sessionIds.length > 0) {
      const { data: finalizedRuns, error: finalizedRunsError } = await supabaseAdmin
        .from('session_runs')
        .select('session_id, user_id, elapsed_seconds, distance_meters')
        .in('session_id', sessionIds)
        .eq('status', 'finalized');

      if (finalizedRunsError) {
        throw new LeagueStandingsLoadError(500, finalizedRunsError.message);
      }

      (finalizedSessions || []).forEach((session) => {
        rankingMatches.push({
          id: `running:${session.id}`,
          status: 'completed',
          week_number: session.week_number,
          winner: null,
        });
      });

      (finalizedRuns || []).forEach((run) => {
        rankingParticipants.push({
          match_id: `running:${run.session_id}`,
          user_id: run.user_id,
          team: null,
          score: null,
          time_seconds: run.elapsed_seconds,
          distance_meters: run.distance_meters,
          points: null,
          set_scores: null,
        });
      });
    }
  }

  const standings = calculateStandings(
    league.scoring_format,
    rankingMatches,
    rankingParticipants,
    rankingMembers,
    {
      runningComparisonMode: league.sport_type === 'running' ? runningComparisonMode : undefined,
    }
  );
  const teamStandings =
    league.scoring_format === 'doubles'
      ? calculateTeamStandings(rankingMatches, rankingParticipants, rankingMembers)
      : [];

  return {
    standings,
    teamStandings,
    runningMode: league.sport_type === 'running' ? runningComparisonMode : null,
    sources: {
      legacyCompletedMatches: legacyMatchIds.length,
      workflowFinalizedFixtures: fixtureIds.length,
      workflowFinalizedSessions: finalizedSessionsCount,
    },
  };
}
