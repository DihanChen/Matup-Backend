export type RankingMatch = {
  id: string;
  status: string;
  week_number: number | null;
  winner?: string | null;
};

export type RankingParticipant = {
  match_id: string;
  user_id: string;
  team: string | null;
  score: number | null;
  time_seconds: number | null;
  distance_meters?: number | null;
  points: number | null;
  set_scores?: { sets: number[][] } | null;
};

export type RankingMember = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
};

export type Standing = {
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

export type TeamStanding = {
  team_key: string;
  player_ids: string[];
  player_names: string[];
  rank: number;
  played: number;
  wins: number;
  losses: number;
  winPct: number;
};

export type RunningComparisonMode = 'absolute_performance' | 'personal_progress';

type StandingOptions = {
  runningComparisonMode?: RunningComparisonMode;
};

export function calculateStandings(
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

export function calculateTeamStandings(
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
