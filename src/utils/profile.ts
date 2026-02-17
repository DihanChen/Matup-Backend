import { supabaseAdmin } from './supabase';

export async function getHostName(userId: string, fallbackEmail?: string): Promise<string> {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .single();

  return profile?.name || fallbackEmail || 'MatUp Host';
}
