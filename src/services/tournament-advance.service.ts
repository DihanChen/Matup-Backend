import { supabaseAdmin } from '../utils/supabase';

type FixtureMetadata = Record<string, unknown>;

/**
 * After a tournament fixture is finalized, advance the winner to the next bracket fixture.
 * Non-blocking — errors are logged but don't propagate.
 */
export async function advanceTournamentWinner(
  fixtureId: string,
  winnerSide: string
): Promise<void> {
  try {
    // Get the fixture metadata to find next_fixture_id
    const { data: fixture } = await supabaseAdmin
      .from('league_fixtures')
      .select('id, league_id, metadata')
      .eq('id', fixtureId)
      .single();

    if (!fixture) return;

    const metadata = fixture.metadata as FixtureMetadata | null;
    if (!metadata) return;

    const nextFixtureId = typeof metadata.next_fixture_id === 'string' ? metadata.next_fixture_id : null;
    const bracketSide = typeof metadata.bracket_slot === 'string' ? metadata.bracket_slot : null;

    if (!nextFixtureId || !bracketSide) return;

    // Determine which side the winner goes to in the next fixture (A or B)
    // bracket_slot is 'A' or 'B' indicating which side of the next match this feeds into
    const nextSide = bracketSide;

    // Get the winning players
    const { data: participants } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('user_id, side')
      .eq('fixture_id', fixtureId)
      .eq('side', winnerSide);

    if (!participants || participants.length === 0) return;

    // Insert them into the next fixture
    const participantRows = participants.map((p) => ({
      fixture_id: nextFixtureId,
      user_id: p.user_id,
      side: nextSide,
      role: 'player',
    }));

    await supabaseAdmin
      .from('league_fixture_participants')
      .insert(participantRows);

    // Check if both sides of the next fixture now have participants
    const { data: nextParticipants } = await supabaseAdmin
      .from('league_fixture_participants')
      .select('side')
      .eq('fixture_id', nextFixtureId);

    const sides = new Set((nextParticipants || []).map((p) => p.side));
    if (sides.has('A') && sides.has('B')) {
      // Both sides filled — update status from 'pending_participants' to 'scheduled'
      await supabaseAdmin
        .from('league_fixtures')
        .update({ status: 'scheduled' })
        .eq('id', nextFixtureId)
        .eq('status', 'pending_participants');
    }
  } catch (error) {
    console.error('Tournament auto-advance error:', error);
  }
}
