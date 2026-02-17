import { type LeagueRow } from './league.service';
import { getNestedArray, getNestedString, type RulesObject } from '../utils/rules';

export function isAssignedDoublesLeague(league: LeagueRow, rules: RulesObject): boolean {
  if (league.scoring_format !== 'doubles') return false;
  const partnerMode = getNestedString(rules, ['match', 'doubles_partner_mode']);
  return partnerMode === 'fixed_pairs' || league.rotation_type === 'assigned';
}

export function getConfiguredFixedPairs(
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
