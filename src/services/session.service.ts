import { supabaseAdmin } from '../utils/supabase';
import { getNestedBoolean, toRulesObject } from '../utils/rules';

export type SessionRow = {
  id: string;
  league_id: string;
  week_number: number | null;
  status: string;
  submission_deadline: string | null;
  distance_meters: number | null;
};

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('running_sessions')
    .select('id, league_id, week_number, status, submission_deadline, distance_meters')
    .eq('id', sessionId)
    .single();

  if (error || !data) return null;
  return data as SessionRow;
}

export async function requiresOrganizerApproval(leagueId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('leagues')
    .select('rules_jsonb')
    .eq('id', leagueId)
    .single();

  const rules = toRulesObject(data?.rules_jsonb);
  const required = getNestedBoolean(rules, ['submissions', 'require_organizer_approval']);
  return required === true;
}
