import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateStandings,
  calculateTeamStandings,
  type RankingMatch,
  type RankingMember,
  type RankingParticipant,
} from '../../services/standings.service';

const members: RankingMember[] = [
  { user_id: 'u1', name: 'One', avatar_url: null },
  { user_id: 'u2', name: 'Two', avatar_url: null },
  { user_id: 'u3', name: 'Three', avatar_url: null },
  { user_id: 'u4', name: 'Four', avatar_url: null },
];

test('calculateStandings ranks singles players by wins and losses', () => {
  const matches: RankingMatch[] = [
    { id: 'm1', status: 'completed', week_number: 1, winner: 'A' },
    { id: 'm2', status: 'completed', week_number: 2, winner: 'B' },
  ];
  const participants: RankingParticipant[] = [
    { match_id: 'm1', user_id: 'u1', team: 'A', score: null, time_seconds: null, points: null },
    { match_id: 'm1', user_id: 'u2', team: 'B', score: null, time_seconds: null, points: null },
    { match_id: 'm2', user_id: 'u3', team: 'A', score: null, time_seconds: null, points: null },
    { match_id: 'm2', user_id: 'u4', team: 'B', score: null, time_seconds: null, points: null },
  ];

  const standings = calculateStandings('singles', matches, participants, members);
  const standingByUser = new Map(standings.map((standing) => [standing.user_id, standing]));

  assert.equal(standingByUser.get('u1')?.wins, 1);
  assert.equal(standingByUser.get('u1')?.losses, 0);
  assert.equal(standingByUser.get('u2')?.wins, 0);
  assert.equal(standingByUser.get('u2')?.losses, 1);
  assert.equal(standingByUser.get('u4')?.wins, 1);
  assert.equal(standings[0]?.rank, 1);
});

test('calculateStandings ranks running individual_time by total time', () => {
  const matches: RankingMatch[] = [
    { id: 'run-1', status: 'completed', week_number: 1, winner: null },
    { id: 'run-2', status: 'completed', week_number: 2, winner: null },
  ];
  const participants: RankingParticipant[] = [
    {
      match_id: 'run-1',
      user_id: 'u1',
      team: null,
      score: null,
      time_seconds: 300,
      distance_meters: 1000,
      points: null,
    },
    {
      match_id: 'run-2',
      user_id: 'u1',
      team: null,
      score: null,
      time_seconds: 290,
      distance_meters: 1000,
      points: null,
    },
    {
      match_id: 'run-1',
      user_id: 'u2',
      team: null,
      score: null,
      time_seconds: 320,
      distance_meters: 1000,
      points: null,
    },
    {
      match_id: 'run-2',
      user_id: 'u2',
      team: null,
      score: null,
      time_seconds: 310,
      distance_meters: 1000,
      points: null,
    },
  ];

  const standings = calculateStandings('individual_time', matches, participants, members);
  assert.equal(standings[0]?.user_id, 'u1');
  assert.ok((standings[0]?.totalTime || 0) < (standings[1]?.totalTime || 0));
});

test('calculateTeamStandings aggregates doubles pair records', () => {
  const matches: RankingMatch[] = [
    { id: 'd1', status: 'completed', week_number: 1, winner: 'A' },
    { id: 'd2', status: 'completed', week_number: 2, winner: 'B' },
  ];
  const participants: RankingParticipant[] = [
    { match_id: 'd1', user_id: 'u1', team: 'A', score: null, time_seconds: null, points: null },
    { match_id: 'd1', user_id: 'u2', team: 'A', score: null, time_seconds: null, points: null },
    { match_id: 'd1', user_id: 'u3', team: 'B', score: null, time_seconds: null, points: null },
    { match_id: 'd1', user_id: 'u4', team: 'B', score: null, time_seconds: null, points: null },
    { match_id: 'd2', user_id: 'u1', team: 'A', score: null, time_seconds: null, points: null },
    { match_id: 'd2', user_id: 'u2', team: 'A', score: null, time_seconds: null, points: null },
    { match_id: 'd2', user_id: 'u3', team: 'B', score: null, time_seconds: null, points: null },
    { match_id: 'd2', user_id: 'u4', team: 'B', score: null, time_seconds: null, points: null },
  ];

  const standings = calculateTeamStandings(matches, participants, members);
  const teamA = standings.find((standing) => standing.team_key === 'u1+u2');
  const teamB = standings.find((standing) => standing.team_key === 'u3+u4');

  assert.equal(teamA?.played, 2);
  assert.equal(teamA?.wins, 1);
  assert.equal(teamB?.wins, 1);
  assert.equal(teamA?.winPct, 50);
  assert.equal(teamB?.winPct, 50);
});
