import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getConfiguredFixedPairs,
  isAssignedDoublesLeague,
} from '../../services/league-rules.service';
import { type LeagueRow } from '../../services/league.service';
import { type RulesObject } from '../../utils/rules';

test('isAssignedDoublesLeague returns true for fixed_pairs doubles league', () => {
  const league: LeagueRow = {
    id: 'league-1',
    sport_type: 'tennis',
    scoring_format: 'doubles',
    name: 'League',
    invite_code: null,
    rotation_type: 'random',
    season_weeks: 8,
    start_date: null,
    rules_jsonb: {},
  };

  const rules: RulesObject = {
    match: {
      doubles_partner_mode: 'fixed_pairs',
    },
  };

  assert.equal(isAssignedDoublesLeague(league, rules), true);
});

test('getConfiguredFixedPairs ignores invalid and duplicate assignments', () => {
  const rules: RulesObject = {
    match: {
      fixed_pairs: [
        ['u1', 'u2'],
        ['u2', 'u3'],
        ['u4', 'u4'],
        ['u5', 'u6'],
      ],
    },
  };

  const validMemberIds = new Set(['u1', 'u2', 'u3', 'u4', 'u5']);
  const result = getConfiguredFixedPairs(rules, validMemberIds);

  assert.deepEqual(result, [['u1', 'u2']]);
});
