import { randomBytes } from 'node:crypto';
import { supabaseAdmin } from '../utils/supabase';

export type LeagueRow = {
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

function generateInviteCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

export async function ensureLeagueInviteCode(
  leagueId: string,
  currentCode: string | null
): Promise<string> {
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

export async function getLeague(leagueId: string): Promise<LeagueRow | null> {
  const { data, error } = await supabaseAdmin
    .from('leagues')
    .select(
      'id, name, sport_type, scoring_format, invite_code, rotation_type, season_weeks, start_date, rules_jsonb'
    )
    .eq('id', leagueId)
    .single();

  if (error || !data) return null;
  return data as LeagueRow;
}
