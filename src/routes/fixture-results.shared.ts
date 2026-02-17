import { supabaseAdmin } from '../utils/supabase';

export type FixtureRow = {
  id: string;
  league_id: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

export type SubmissionRow = {
  id: string;
  fixture_id: string;
  submitted_by: string;
  source: string;
  status: string;
  payload: Record<string, unknown>;
};

export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function getFixture(fixtureId: string): Promise<FixtureRow | null> {
  const { data, error } = await supabaseAdmin
    .from('league_fixtures')
    .select('id, league_id, status, metadata')
    .eq('id', fixtureId)
    .single();

  if (error || !data) return null;
  return data as FixtureRow;
}

export async function getFixtureSide(
  fixtureId: string,
  userId: string
): Promise<'A' | 'B' | null> {
  const { data, error } = await supabaseAdmin
    .from('league_fixture_participants')
    .select('side')
    .eq('fixture_id', fixtureId)
    .eq('user_id', userId)
    .single();

  if (error || !data?.side) return null;
  return data.side as 'A' | 'B';
}
