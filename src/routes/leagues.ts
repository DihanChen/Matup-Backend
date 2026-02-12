import { Router, Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../utils/supabase';
import { getLeagueRole, isLeagueAdminRole } from '../utils/league-access';
import {
  generateSinglesSchedule,
  generateDoublesAssignedSchedule,
  generateDoublesRandomSchedule,
} from '../services/fixture-schedule.service';
import { sendGroupEmail } from '../services/email.service';
import { env } from '../config/env';

const router = Router();

type LeagueRow = {
  id: string;
  sport_type: string;
  scoring_format: string;
  name: string;
  invite_code: string | null;
  rotation_type: string | null;
  season_weeks: number | null;
  start_date: string | null;
  rules_jsonb: unknown;
};

type RulesObject = Record<string, unknown>;
type FinalResultPayload = {
  winner?: 'A' | 'B';
  sets?: number[][];
};

type RankingMatch = {
  id: string;
  status: string;
  week_number: number | null;
  winner?: string | null;
};

type RankingParticipant = {
  match_id: string;
  user_id: string;
  team: string | null;
  score: number | null;
  time_seconds: number | null;
  distance_meters?: number | null;
  points: number | null;
  set_scores?: { sets: number[][] } | null;
};

type RankingMember = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
};

type Standing = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goalDifference: number;
  totalTime: number;
  totalPoints: number;
};

type TeamStanding = {
  team_key: string;
  player_ids: string[];
  player_names: string[];
  rank: number;
  played: number;
  wins: number;
  losses: number;
  winPct: number;
};

type RunningComparisonMode = 'absolute_performance' | 'personal_progress';

type StandingOptions = {
  runningComparisonMode?: RunningComparisonMode;
};

type LeagueInviteRow = {
  id: string;
  league_id: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'expired';
  invited_by: string | null;
  invited_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string | null;
};

function normalizeInviteEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const normalized = input
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((email) => emailRegex.test(email));
  return [...new Set(normalized)];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateInviteCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

async function ensureLeagueInviteCode(leagueId: string, currentCode: string | null): Promise<string> {
  if (currentCode) return currentCode;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = generateInviteCode();
    const { data, error } = await supabaseAdmin
      .from('leagues')
      .update({ invite_code: candidate })
      .eq('id', leagueId)
      .is('invite_code', null)
      .select('invite_code')
      .single();

    if (!error && data?.invite_code) {
      return data.invite_code;
    }
  }

  const { data } = await supabaseAdmin
    .from('leagues')
    .select('invite_code')
    .eq('id', leagueId)
    .single();
  if (data?.invite_code) {
    return data.invite_code;
  }

  throw new Error('Failed to assign invite code');
}

function buildInviteEmailHtml(params: {
  leagueName: string;
  hostName: string;
  joinLink: string;
  inviteCode: string;
}): string {
  return `
    <div style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e4e4e7; overflow: hidden;">
        <div style="padding: 20px 24px; background: #18181b; color: #ffffff;">
          <div style="font-size: 14px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.7;">MatUp</div>
          <div style="font-size: 20px; font-weight: 700; margin-top: 6px;">You are invited to join ${escapeHtml(params.leagueName)}</div>
        </div>
        <div style="padding: 24px;">
          <p style="font-size: 14px; color: #52525b; margin: 0 0 8px;">${escapeHtml(params.hostName)} invited you to this league.</p>
          <p style="font-size: 14px; color: #52525b; margin: 0 0 16px;">Join code: <strong>${escapeHtml(params.inviteCode)}</strong></p>
          <a href="${params.joinLink}" style="display: inline-block; padding: 10px 18px; background: #18181b; color: #ffffff; border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 600;">Join League</a>
        </div>
      </div>
    </div>
  `;
}

async function getHostName(userId: string, fallbackEmail?: string): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single();
  return profile?.name || fallbackEmail || 'MatUp Host';
}

function toRulesObject(value: unknown): RulesObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as RulesObject;
  }
  return {};
}

function getNestedNumber(obj: RulesObject, path: string[]): number | null {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : null;
}

function getNestedString(obj: RulesObject, path: string[]): string | null {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : null;
}

function getNestedArray(obj: RulesObject, path: string[]): unknown[] | null {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : null;
}

function isAssignedDoublesLeague(league: LeagueRow, rules: RulesObject): boolean {
  if (league.scoring_format !== 'doubles') return false;
  const partnerMode = getNestedString(rules, ['match', 'doubles_partner_mode']);
  return partnerMode === 'fixed_pairs' || league.rotation_type === 'assigned';
}

function getConfiguredFixedPairs(
  rules: RulesObject,
  validMemberIds: Set<string>
): Array<[string, string]> {
  const fixedPairs = getNestedArray(rules, ['match', 'fixed_pairs']);
  if (!fixedPairs) return [];

  const used = new Set<string>();
  const normalized: Array<[string, string]> = [];

  for (const entry of fixedPairs) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const a = typeof entry[0] === 'string' ? entry[0] : '';
    const b = typeof entry[1] === 'string' ? entry[1] : '';
    if (!a || !b || a === b) continue;
    if (!validMemberIds.has(a) || !validMemberIds.has(b)) continue;
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    normalized.push([a, b]);
  }

  return normalized;
}

function weekStartIso(startDate: string | null, weekNumber: number): string | null {
  if (!startDate) return null;
  const base = new Date(`${startDate}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + (weekNumber - 1) * 7);
  return base.toISOString();
}

function weekEndIso(startsAt: string | null): string | null {
  if (!startsAt) return null;
  const end = new Date(startsAt);
  if (Number.isNaN(end.getTime())) return null;
  end.setUTCHours(end.getUTCHours() + 2);
  return end.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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

function calculateStandings(
  scoringFormat: string,
  matches: RankingMatch[],
  participants: RankingParticipant[],
  members: RankingMember[],
  options: StandingOptions = {}
): Standing[] {
  const completedMatches = matches.filter((m) => m.status === 'completed');
  const completedMatchIds = new Set(completedMatches.map((m) => m.id));
  const relevantParticipants = participants.filter((p) =>
    completedMatchIds.has(p.match_id)
  );

  if (scoringFormat === 'team_vs_team') {
    const stats: Record<
      string,
      {
        played: number;
        wins: number;
        draws: number;
        losses: number;
        points: number;
        goalsFor: number;
        goalsAgainst: number;
      }
    > = {};

    for (const member of members) {
      stats[member.user_id] = {
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      };
    }

    for (const match of completedMatches) {
      const matchParticipants = relevantParticipants.filter(
        (participant) => participant.match_id === match.id
      );
      const teamA = matchParticipants.filter((participant) => participant.team === 'A');
      const teamB = matchParticipants.filter((participant) => participant.team === 'B');
      if (teamA.length === 0 || teamB.length === 0) continue;

      const scoreA = teamA[0]?.score ?? 0;
      const scoreB = teamB[0]?.score ?? 0;

      for (const participant of teamA) {
        if (!stats[participant.user_id]) {
          stats[participant.user_id] = {
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            points: 0,
            goalsFor: 0,
            goalsAgainst: 0,
          };
        }
        stats[participant.user_id].played += 1;
        stats[participant.user_id].goalsFor += scoreA;
        stats[participant.user_id].goalsAgainst += scoreB;
        if (scoreA > scoreB) {
          stats[participant.user_id].wins += 1;
          stats[participant.user_id].points += 3;
        } else if (scoreA === scoreB) {
          stats[participant.user_id].draws += 1;
          stats[participant.user_id].points += 1;
        } else {
          stats[participant.user_id].losses += 1;
        }
      }

      for (const participant of teamB) {
        if (!stats[participant.user_id]) {
          stats[participant.user_id] = {
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            points: 0,
            goalsFor: 0,
            goalsAgainst: 0,
          };
        }
        stats[participant.user_id].played += 1;
        stats[participant.user_id].goalsFor += scoreB;
        stats[participant.user_id].goalsAgainst += scoreA;
        if (scoreB > scoreA) {
          stats[participant.user_id].wins += 1;
          stats[participant.user_id].points += 3;
        } else if (scoreB === scoreA) {
          stats[participant.user_id].draws += 1;
          stats[participant.user_id].points += 1;
        } else {
          stats[participant.user_id].losses += 1;
        }
      }
    }

    const standings = Object.entries(stats).map(([userId, stat]) => {
      const member = members.find((item) => item.user_id === userId);
      return {
        user_id: userId,
        name: member?.name ?? null,
        avatar_url: member?.avatar_url ?? null,
        rank: 0,
        played: stat.played,
        wins: stat.wins,
        draws: stat.draws,
        losses: stat.losses,
        points: stat.points,
        goalDifference: stat.goalsFor - stat.goalsAgainst,
        totalTime: 0,
        totalPoints: 0,
      };
    });

    standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.played - a.played;
    });

    standings.forEach((standing, index) => {
      standing.rank = index + 1;
    });
    return standings;
  }

  if (scoringFormat === 'individual_time') {
    const runningComparisonMode = options.runningComparisonMode || 'absolute_performance';
    const stats: Record<string, { played: number; totalTime: number; bestTime: number }> = {};
    for (const member of members) {
      stats[member.user_id] = {
        played: 0,
        totalTime: 0,
        bestTime: Number.POSITIVE_INFINITY,
      };
    }

    for (const participant of relevantParticipants) {
      if (participant.time_seconds == null) continue;
      if (!stats[participant.user_id]) {
        stats[participant.user_id] = {
          played: 0,
          totalTime: 0,
          bestTime: Number.POSITIVE_INFINITY,
        };
      }
      stats[participant.user_id].played += 1;
      stats[participant.user_id].totalTime += participant.time_seconds;
      stats[participant.user_id].bestTime = Math.min(
        stats[participant.user_id].bestTime,
        participant.time_seconds
      );
    }

    if (runningComparisonMode === 'personal_progress') {
      const weekByMatchId = new Map<string, number>();
      completedMatches.forEach((match) => {
        weekByMatchId.set(match.id, match.week_number ?? Number.MAX_SAFE_INTEGER);
      });
      const runsByUser: Record<
        string,
        Array<{ week: number; paceSecondsPerKm: number; elapsedSeconds: number }>
      > = {};

      for (const participant of relevantParticipants) {
        if (participant.time_seconds == null) continue;

        const distanceMeters =
          participant.distance_meters && participant.distance_meters > 0
            ? participant.distance_meters
            : 1000;
        const paceSecondsPerKm = participant.time_seconds / (distanceMeters / 1000);
        if (!Number.isFinite(paceSecondsPerKm) || paceSecondsPerKm <= 0) continue;

        if (!runsByUser[participant.user_id]) {
          runsByUser[participant.user_id] = [];
        }
        runsByUser[participant.user_id].push({
          week: weekByMatchId.get(participant.match_id) ?? Number.MAX_SAFE_INTEGER,
          paceSecondsPerKm,
          elapsedSeconds: participant.time_seconds,
        });
      }

      const standings = members.map((member) => {
        const runs = (runsByUser[member.user_id] || []).sort((a, b) =>
          a.week === b.week ? a.elapsedSeconds - b.elapsedSeconds : a.week - b.week
        );

        let totalImprovementPercent = 0;
        let improvementCount = 0;
        let regressionCount = 0;
        let comparisons = 0;

        for (let index = 1; index < runs.length; index += 1) {
          const previous = runs[index - 1];
          const current = runs[index];
          const improvementPercent =
            ((previous.paceSecondsPerKm - current.paceSecondsPerKm) /
              previous.paceSecondsPerKm) *
            100;
          if (!Number.isFinite(improvementPercent)) continue;
          totalImprovementPercent += improvementPercent;
          comparisons += 1;

          if (improvementPercent > 0) improvementCount += 1;
          if (improvementPercent < 0) regressionCount += 1;
        }

        const normalizedImprovement =
          comparisons > 0
            ? Number(totalImprovementPercent.toFixed(2))
            : 0;

        return {
          user_id: member.user_id,
          name: member.name ?? null,
          avatar_url: member.avatar_url ?? null,
          rank: 0,
          played: runs.length,
          wins: improvementCount,
          draws: 0,
          losses: regressionCount,
          points: normalizedImprovement,
          goalDifference: 0,
          totalTime: runs.reduce((total, run) => total + run.elapsedSeconds, 0),
          totalPoints: normalizedImprovement,
        };
      });

      standings.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.played !== a.played) return b.played - a.played;
        return a.totalTime - b.totalTime;
      });

      standings.forEach((standing, index) => {
        standing.rank = index + 1;
      });
      return standings;
    }

    const standings = Object.entries(stats).map(([userId, stat]) => {
      const member = members.find((item) => item.user_id === userId);
      return {
        user_id: userId,
        name: member?.name ?? null,
        avatar_url: member?.avatar_url ?? null,
        rank: 0,
        played: stat.played,
        wins: 0,
        draws: 0,
        losses: 0,
        points: stat.played,
        goalDifference: 0,
        totalTime: stat.totalTime,
        totalPoints: 0,
      };
    });

    standings.sort((a, b) => {
      if (a.played === 0 && b.played === 0) return 0;
      if (a.played === 0) return 1;
      if (b.played === 0) return -1;
      return a.totalTime - b.totalTime;
    });

    standings.forEach((standing, index) => {
      standing.rank = index + 1;
    });
    return standings;
  }

  if (scoringFormat === 'individual_points') {
    const stats: Record<string, { played: number; totalPoints: number }> = {};
    for (const member of members) {
      stats[member.user_id] = { played: 0, totalPoints: 0 };
    }

    for (const participant of relevantParticipants) {
      if (participant.points == null) continue;
      if (!stats[participant.user_id]) {
        stats[participant.user_id] = { played: 0, totalPoints: 0 };
      }
      stats[participant.user_id].played += 1;
      stats[participant.user_id].totalPoints += participant.points;
    }

    const standings = Object.entries(stats).map(([userId, stat]) => {
      const member = members.find((item) => item.user_id === userId);
      return {
        user_id: userId,
        name: member?.name ?? null,
        avatar_url: member?.avatar_url ?? null,
        rank: 0,
        played: stat.played,
        wins: 0,
        draws: 0,
        losses: 0,
        points: stat.totalPoints,
        goalDifference: 0,
        totalTime: 0,
        totalPoints: stat.totalPoints,
      };
    });

    standings.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return b.played - a.played;
    });

    standings.forEach((standing, index) => {
      standing.rank = index + 1;
    });
    return standings;
  }

  if (scoringFormat !== 'singles' && scoringFormat !== 'doubles') {
    return members.map((member, index) => ({
      user_id: member.user_id,
      name: member.name,
      avatar_url: member.avatar_url,
      rank: index + 1,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      goalDifference: 0,
      totalTime: 0,
      totalPoints: 0,
    }));
  }

  // singles + doubles individual view
  const stats: Record<string, { played: number; wins: number; losses: number }> = {};
  for (const member of members) {
    stats[member.user_id] = { played: 0, wins: 0, losses: 0 };
  }

  for (const match of completedMatches) {
    if (!match.winner) continue;
    const matchParticipants = relevantParticipants.filter(
      (participant) => participant.match_id === match.id
    );
    const teamA = matchParticipants.filter((participant) => participant.team === 'A');
    const teamB = matchParticipants.filter((participant) => participant.team === 'B');
    const winners = match.winner === 'A' ? teamA : teamB;
    const losers = match.winner === 'A' ? teamB : teamA;

    for (const participant of winners) {
      if (!stats[participant.user_id]) {
        stats[participant.user_id] = { played: 0, wins: 0, losses: 0 };
      }
      stats[participant.user_id].played += 1;
      stats[participant.user_id].wins += 1;
    }
    for (const participant of losers) {
      if (!stats[participant.user_id]) {
        stats[participant.user_id] = { played: 0, wins: 0, losses: 0 };
      }
      stats[participant.user_id].played += 1;
      stats[participant.user_id].losses += 1;
    }
  }

  const standings = Object.entries(stats).map(([userId, stat]) => {
    const member = members.find((item) => item.user_id === userId);
    return {
      user_id: userId,
      name: member?.name ?? null,
      avatar_url: member?.avatar_url ?? null,
      rank: 0,
      played: stat.played,
      wins: stat.wins,
      draws: 0,
      losses: stat.losses,
      points: stat.wins,
      goalDifference: 0,
      totalTime: 0,
      totalPoints: 0,
    };
  });

  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return b.played - a.played;
  });

  standings.forEach((standing, index) => {
    standing.rank = index + 1;
  });
  return standings;
}

function calculateTeamStandings(
  matches: RankingMatch[],
  participants: RankingParticipant[],
  members: RankingMember[]
): TeamStanding[] {
  const completedMatches = matches.filter((match) => match.status === 'completed');
  const completedMatchIds = new Set(completedMatches.map((match) => match.id));
  const relevantParticipants = participants.filter((participant) =>
    completedMatchIds.has(participant.match_id)
  );

  const stats: Record<
    string,
    { player_ids: string[]; played: number; wins: number; losses: number }
  > = {};

  for (const match of completedMatches) {
    if (!match.winner) continue;
    const matchParticipants = relevantParticipants.filter(
      (participant) => participant.match_id === match.id
    );
    const sideA = matchParticipants
      .filter((participant) => participant.team === 'A')
      .map((participant) => participant.user_id)
      .sort();
    const sideB = matchParticipants
      .filter((participant) => participant.team === 'B')
      .map((participant) => participant.user_id)
      .sort();

    if (sideA.length < 2 || sideB.length < 2) continue;

    const sideAKey = sideA.join('+');
    const sideBKey = sideB.join('+');
    if (!stats[sideAKey]) {
      stats[sideAKey] = { player_ids: sideA, played: 0, wins: 0, losses: 0 };
    }
    if (!stats[sideBKey]) {
      stats[sideBKey] = { player_ids: sideB, played: 0, wins: 0, losses: 0 };
    }

    stats[sideAKey].played += 1;
    stats[sideBKey].played += 1;
    if (match.winner === 'A') {
      stats[sideAKey].wins += 1;
      stats[sideBKey].losses += 1;
    } else {
      stats[sideBKey].wins += 1;
      stats[sideAKey].losses += 1;
    }
  }

  const standings: TeamStanding[] = Object.entries(stats).map(([teamKey, stat]) => ({
    team_key: teamKey,
    player_ids: stat.player_ids,
    player_names: stat.player_ids.map((playerId) => {
      const member = members.find((item) => item.user_id === playerId);
      return member?.name ?? 'Unknown';
    }),
    rank: 0,
    played: stat.played,
    wins: stat.wins,
    losses: stat.losses,
    winPct: stat.played > 0 ? Math.round((stat.wins / stat.played) * 100) : 0,
  }));

  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return b.winPct - a.winPct;
  });

  standings.forEach((standing, index) => {
    standing.rank = index + 1;
  });
  return standings;
}

async function getLeague(leagueId: string): Promise<LeagueRow | null> {
  const { data, error } = await supabaseAdmin
    .from('leagues')
    .select('id, name, sport_type, scoring_format, invite_code, rotation_type, season_weeks, start_date, rules_jsonb')
    .eq('id', leagueId)
    .single();

  if (error || !data) return null;
  return data as LeagueRow;
}

router.get('/:id/invites', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can view invites' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const inviteCode = await ensureLeagueInviteCode(leagueId, league.invite_code);
    const { data: invites, error } = await supabaseAdmin
      .from('league_invites')
      .select('id, email, status, invited_at, claimed_at, expires_at')
      .eq('league_id', leagueId)
      .order('invited_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      inviteCode,
      invites: invites || [],
    });
  } catch (error) {
    console.error('League invites fetch error:', error);
    res.status(500).json({ error: 'Failed to load invites' });
  }
});

router.post('/:id/invites', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId, userEmail } = req as AuthenticatedRequest;
    const emails = normalizeInviteEmails(req.body?.emails);

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    if (emails.length === 0) {
      res.status(400).json({ error: 'At least one valid email is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can send invites' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const inviteCode = await ensureLeagueInviteCode(leagueId, league.invite_code);
    const inviteRows = emails.map((email) => ({
      league_id: leagueId,
      email,
      token: randomUUID(),
      status: 'pending',
      invited_by: userId,
      invited_at: new Date().toISOString(),
      claimed_by: null,
      claimed_at: null,
    }));

    const { data: savedInvites, error: upsertError } = await supabaseAdmin
      .from('league_invites')
      .upsert(inviteRows, { onConflict: 'league_id,email' })
      .select('id, league_id, email, token, status, invited_by, invited_at, claimed_by, claimed_at, expires_at');

    if (upsertError) {
      res.status(500).json({ error: upsertError.message });
      return;
    }

    const subject = `You're invited to join ${league.name} on MatUp`;
    const hostName = await getHostName(userId, userEmail);

    let sent = 0;
    let failed: Array<{ email: string; error: string }> = [];
    let emailError: string | null = null;

    try {
      const inviteRowsToSend = (savedInvites || []) as LeagueInviteRow[];
      for (const invite of inviteRowsToSend) {
        if (invite.status !== 'pending') {
          continue;
        }

        const joinLink = `${env.frontendUrl}/leagues/join?leagueId=${league.id}&code=${inviteCode}&inviteToken=${invite.token}`;
        const htmlBody = buildInviteEmailHtml({
          leagueName: league.name,
          hostName,
          joinLink,
          inviteCode,
        });
        const sendResult = await sendGroupEmail({
          recipients: [invite.email],
          subject,
          htmlBody,
          replyTo: userEmail,
        });
        sent += sendResult.sent;
        failed.push(...sendResult.failed);
      }
    } catch (sendError) {
      emailError =
        sendError instanceof Error ? sendError.message : 'Failed to send invite emails';
    }

    const { data: invites, error: inviteFetchError } = await supabaseAdmin
      .from('league_invites')
      .select('id, email, status, invited_at, claimed_at, expires_at')
      .eq('league_id', leagueId)
      .order('invited_at', { ascending: false });

    if (inviteFetchError) {
      res.status(500).json({ error: inviteFetchError.message });
      return;
    }

    res.json({
      success: true,
      inviteCode,
      sent,
      failed,
      emailError,
      invites: invites || [],
    });
  } catch (error) {
    console.error('League invite send error:', error);
    res.status(500).json({ error: 'Failed to send invites' });
  }
});

router.post('/:id/join', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId, userEmail } = req as AuthenticatedRequest;
    const inviteCode =
      typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.trim() : '';
    const inviteToken =
      typeof req.body?.inviteToken === 'string' ? req.body.inviteToken.trim() : '';

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    if (!inviteCode && !inviteToken) {
      res.status(400).json({ error: 'inviteCode or inviteToken is required' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const currentRole = await getLeagueRole(leagueId, userId);
    if (currentRole) {
      res.json({ success: true, alreadyMember: true });
      return;
    }

    let inviteRow: LeagueInviteRow | null = null;
    if (inviteToken) {
      const { data } = await supabaseAdmin
        .from('league_invites')
        .select('id, league_id, email, token, status, invited_by, invited_at, claimed_by, claimed_at, expires_at')
        .eq('league_id', leagueId)
        .eq('token', inviteToken)
        .eq('status', 'pending')
        .single();
      inviteRow = (data as LeagueInviteRow | null) || null;

      if (!inviteRow) {
        res.status(403).json({ error: 'Invite token is invalid or expired' });
        return;
      }

      if (!userEmail || inviteRow.email.toLowerCase() !== userEmail.toLowerCase()) {
        res.status(403).json({ error: 'Invite token does not match your account email' });
        return;
      }
    } else {
      const leagueInviteCode = await ensureLeagueInviteCode(leagueId, league.invite_code);
      if (inviteCode.toUpperCase() !== leagueInviteCode.toUpperCase()) {
        res.status(403).json({ error: 'Invite code is invalid' });
        return;
      }
    }

    const { error: insertError } = await supabaseAdmin
      .from('league_members')
      .insert({
        league_id: leagueId,
        user_id: userId,
        role: 'member',
      });

    if (insertError && insertError.code !== '23505') {
      res.status(500).json({ error: insertError.message });
      return;
    }

    const now = new Date().toISOString();
    if (inviteRow) {
      await supabaseAdmin
        .from('league_invites')
        .update({
          status: 'accepted',
          claimed_by: userId,
          claimed_at: now,
        })
        .eq('id', inviteRow.id);
    } else if (userEmail) {
      await supabaseAdmin
        .from('league_invites')
        .update({
          status: 'accepted',
          claimed_by: userId,
          claimed_at: now,
        })
        .eq('league_id', leagueId)
        .eq('status', 'pending')
        .ilike('email', userEmail);
    }

    res.json({ success: true, alreadyMember: false });
  } catch (error) {
    console.error('League join error:', error);
    res.status(500).json({ error: 'Failed to join league' });
  }
});

router.get('/:id/teams/assigned', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!role) {
      res.status(403).json({ error: 'You must be a league member to view assigned teams' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const rules = toRulesObject(league.rules_jsonb);
    if (!isAssignedDoublesLeague(league, rules)) {
      res.status(400).json({ error: 'Assigned teams are only available for doubles assigned leagues' });
      return;
    }

    const { data: memberRows, error: memberError } = await supabaseAdmin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);

    if (memberError) {
      res.status(500).json({ error: memberError.message });
      return;
    }

    const memberIds = (memberRows || []).map((item) => item.user_id);
    const memberIdSet = new Set(memberIds);
    const configuredPairs = getConfiguredFixedPairs(rules, memberIdSet);
    const pairedUserIds = new Set(configuredPairs.flat());
    const unpairedMemberIds = memberIds.filter((memberId) => !pairedUserIds.has(memberId));

    const { data: profiles } = memberIds.length
      ? await supabaseAdmin.from('profiles').select('id, name').in('id', memberIds)
      : { data: [] as Array<{ id: string; name: string | null }> };
    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.name]));

    res.json({
      pairs: configuredPairs.map((pair) => ({
        playerAId: pair[0],
        playerAName: profileMap.get(pair[0]) || null,
        playerBId: pair[1],
        playerBName: profileMap.get(pair[1]) || null,
      })),
      unpairedMemberIds,
    });
  } catch (error) {
    console.error('Assigned teams fetch error:', error);
    res.status(500).json({ error: 'Failed to load assigned teams' });
  }
});

router.put('/:id/teams/assigned', requireAuth, async (req: Request, res: Response) => {
  try {
    const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { userId } = req as AuthenticatedRequest;
    const pairsInput = Array.isArray(req.body?.pairs) ? req.body.pairs : null;

    if (!leagueId) {
      res.status(400).json({ error: 'league id is required' });
      return;
    }

    const role = await getLeagueRole(leagueId, userId);
    if (!isLeagueAdminRole(role)) {
      res.status(403).json({ error: 'Only league owner/admin can edit assigned teams' });
      return;
    }

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    const rules = toRulesObject(league.rules_jsonb);
    if (!isAssignedDoublesLeague(league, rules)) {
      res.status(400).json({ error: 'Assigned teams are only available for doubles assigned leagues' });
      return;
    }

    if (!pairsInput) {
      res.status(400).json({ error: 'pairs is required and must be an array' });
      return;
    }

    const { data: memberRows, error: memberError } = await supabaseAdmin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);

    if (memberError) {
      res.status(500).json({ error: memberError.message });
      return;
    }

    const memberIds = (memberRows || []).map((item) => item.user_id);
    const memberIdSet = new Set(memberIds);
    const used = new Set<string>();
    const fixedPairs: Array<[string, string]> = [];

    for (const entry of pairsInput) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        res.status(400).json({ error: 'Each pair must be an object with playerAId and playerBId' });
        return;
      }

      const pairEntry = entry as Record<string, unknown>;
      const playerAId = typeof pairEntry.playerAId === 'string' ? pairEntry.playerAId.trim() : '';
      const playerBId = typeof pairEntry.playerBId === 'string' ? pairEntry.playerBId.trim() : '';

      if (!playerAId || !playerBId) {
        res.status(400).json({ error: 'Each pair must include playerAId and playerBId' });
        return;
      }
      if (playerAId === playerBId) {
        res.status(400).json({ error: 'A team cannot contain the same player twice' });
        return;
      }
      if (!memberIdSet.has(playerAId) || !memberIdSet.has(playerBId)) {
        res.status(400).json({ error: 'All assigned players must be current league members' });
        return;
      }
      if (used.has(playerAId) || used.has(playerBId)) {
        res.status(400).json({ error: 'Each player can only appear in one team' });
        return;
      }

      used.add(playerAId);
      used.add(playerBId);
      fixedPairs.push([playerAId, playerBId]);
    }

    const nextRules: RulesObject = {
      ...rules,
      match: {
        ...(toRulesObject((rules as Record<string, unknown>).match)),
        fixed_pairs: fixedPairs,
      },
    };

    const { error: updateError } = await supabaseAdmin
      .from('leagues')
      .update({ rules_jsonb: nextRules })
      .eq('id', leagueId);

    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }

    const unpairedMemberIds = memberIds.filter((memberId) => !used.has(memberId));
    const { data: profiles } = memberIds.length
      ? await supabaseAdmin.from('profiles').select('id, name').in('id', memberIds)
      : { data: [] as Array<{ id: string; name: string | null }> };
    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.name]));

    res.json({
      success: true,
      pairs: fixedPairs.map((pair) => ({
        playerAId: pair[0],
        playerAName: profileMap.get(pair[0]) || null,
        playerBId: pair[1],
        playerBName: profileMap.get(pair[1]) || null,
      })),
      unpairedMemberIds,
    });
  } catch (error) {
    console.error('Assigned teams update error:', error);
    res.status(500).json({ error: 'Failed to update assigned teams' });
  }
});

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
    const startDate =
      getNestedString(rules, ['schedule', 'starts_on']) || league.start_date;

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

    // Running: generate weekly running sessions and paired fixture records.
    if (league.sport_type === 'running') {
      const sessionType =
        getNestedString(rules, ['sessions', 'default_session_type']) || 'time_trial';
      const comparisonMode =
        getNestedString(rules, ['sessions', 'comparison_mode']) || 'personal_progress';

      let createdFixtures = 0;
      let createdSessions = 0;

      for (let week = 1; week <= seasonWeeks; week++) {
        const startsAt = weekStartIso(startDate, week);
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

    // Racket sports schedule generation (tennis + pickleball).
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
          error:
            'Assigned doubles requires at least 2 fixed teams. Configure teams first.',
        });
        return;
      }
      schedule = isAssigned
        ? generateDoublesAssignedSchedule(memberIds, seasonWeeks, configuredFixedPairs)
        : generateDoublesRandomSchedule(memberIds, seasonWeeks);
    } else {
      res.status(400).json({ error: `Scheduling is not supported for ${league.scoring_format}` });
      return;
    }

    let createdFixtures = 0;
    let createdParticipants = 0;

    for (const entry of schedule) {
      const startsAt = weekStartIso(startDate, entry.weekNumber);
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
      .select('id, week_number, starts_at, ends_at, fixture_type, status, metadata, created_at, updated_at')
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

    const profileMap = new Map(
      (profiles || []).map((profile) => [profile.id, profile])
    );
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

    const league = await getLeague(leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }
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
      res.status(500).json({ error: memberError.message });
      return;
    }

    const memberIds = (memberRows || []).map((item) => item.user_id);
    const { data: profiles } = memberIds.length
      ? await supabaseAdmin
          .from('profiles')
          .select('id, name, avatar_url')
          .in('id', memberIds)
      : { data: [] as Array<{ id: string; name: string | null; avatar_url: string | null }> };

    const rankingMembers: RankingMember[] = memberIds.map((memberId) => {
      const profile = (profiles || []).find((item) => item.id === memberId);
      return {
        user_id: memberId,
        name: profile?.name || null,
        avatar_url: profile?.avatar_url || null,
      };
    });

    const rankingMatches: RankingMatch[] = [];
    const rankingParticipants: RankingParticipant[] = [];

    // Legacy completed matches.
    const { data: legacyMatches, error: legacyMatchesError } = await supabaseAdmin
      .from('league_matches')
      .select('id, status, week_number, winner')
      .eq('league_id', leagueId)
      .eq('status', 'completed');

    if (legacyMatchesError) {
      res.status(500).json({ error: legacyMatchesError.message });
      return;
    }

    const legacyMatchIds = (legacyMatches || []).map((match) => match.id);
    if (legacyMatchIds.length > 0) {
      const { data: legacyParticipants, error: legacyParticipantError } = await supabaseAdmin
        .from('match_participants')
        .select('match_id, user_id, team, score, time_seconds, points, set_scores')
        .in('match_id', legacyMatchIds);

      if (legacyParticipantError) {
        res.status(500).json({ error: legacyParticipantError.message });
        return;
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

    // Workflow finalized fixtures.
    const { data: fixtures, error: fixtureError } = await supabaseAdmin
      .from('league_fixtures')
      .select('id, status, week_number, metadata')
      .eq('league_id', leagueId)
      .eq('status', 'finalized');

    if (fixtureError) {
      res.status(500).json({ error: fixtureError.message });
      return;
    }

    const fixtureIds = (fixtures || []).map((fixture) => fixture.id);
    if (fixtureIds.length > 0) {
      const { data: fixtureParticipants, error: fixtureParticipantError } = await supabaseAdmin
        .from('league_fixture_participants')
        .select('fixture_id, user_id, side')
        .in('fixture_id', fixtureIds);

      if (fixtureParticipantError) {
        res.status(500).json({ error: fixtureParticipantError.message });
        return;
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
        const fixture = (fixtures || []).find((item) => item.id === participant.fixture_id);
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
        res.status(500).json({ error: finalizedSessionsError.message });
        return;
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
          res.status(500).json({ error: finalizedRunsError.message });
          return;
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
        runningComparisonMode:
          league.sport_type === 'running' ? runningComparisonMode : undefined,
      }
    );
    const teamStandings =
      league.scoring_format === 'doubles'
        ? calculateTeamStandings(rankingMatches, rankingParticipants, rankingMembers)
        : [];

    res.json({
      standings,
      teamStandings,
      runningMode: league.sport_type === 'running' ? runningComparisonMode : null,
      sources: {
        legacyCompletedMatches: legacyMatchIds.length,
        workflowFinalizedFixtures: fixtureIds.length,
        workflowFinalizedSessions: finalizedSessionsCount,
      },
    });
  } catch (error) {
    console.error('Standings fetch error:', error);
    res.status(500).json({ error: 'Failed to load standings' });
  }
});

export default router;
