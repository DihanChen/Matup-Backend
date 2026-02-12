import { supabaseAdmin } from './supabase';

export async function getLeagueRole(
  leagueId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('league_members')
    .select('role')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .single();

  if (error || !data?.role) return null;
  return data.role;
}

export function isLeagueAdminRole(role: string | null): boolean {
  return role === 'owner' || role === 'admin';
}
