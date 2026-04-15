/**
 * Data migration script: Convert remaining league_matches into league_fixtures + league_fixture_participants
 *
 * This script reads all legacy matches from `league_matches` + `match_participants`
 * and creates corresponding rows in `league_fixtures` + `league_fixture_participants`.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-legacy-matches.ts
 *
 * The script is idempotent — it skips matches that have already been migrated
 * (tracked via metadata.migrated_from_legacy_match_id).
 *
 * Legacy tables are NOT dropped — they are deprecated in place.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

type LegacyMatch = {
  id: string;
  league_id: string;
  week_number: number | null;
  match_date: string | null;
  status: string;
  winner: string | null;
  notes: string | null;
  created_at: string;
};

type LegacyParticipant = {
  match_id: string;
  user_id: string;
  team: string | null;
  score: number | null;
  time_seconds: number | null;
  points: number | null;
  set_scores: { sets: number[][] } | null;
};

function mapLegacyStatus(status: string): string {
  if (status === 'completed') return 'finalized';
  if (status === 'cancelled') return 'cancelled';
  return 'scheduled';
}

function buildFinalResult(
  winner: string | null,
  participants: LegacyParticipant[]
): Record<string, unknown> | null {
  if (!winner) return null;

  const sideA = participants.filter((p) => p.team === 'A');
  const firstA = sideA[0];
  const sets = firstA?.set_scores?.sets;

  return {
    winner,
    ...(sets && sets.length > 0 ? { sets } : {}),
  };
}

async function migrate() {
  console.log('Starting legacy match migration...');

  // 1. Get all legacy matches
  const { data: legacyMatches, error: matchError } = await supabase
    .from('league_matches')
    .select('id, league_id, week_number, match_date, status, winner, notes, created_at')
    .order('created_at', { ascending: true });

  if (matchError) {
    console.error('Failed to load legacy matches:', matchError.message);
    process.exit(1);
  }

  if (!legacyMatches || legacyMatches.length === 0) {
    console.log('No legacy matches found. Nothing to migrate.');
    return;
  }

  console.log(`Found ${legacyMatches.length} legacy matches`);

  // 2. Get all legacy participants
  const matchIds = legacyMatches.map((m) => m.id);
  const { data: allParticipants, error: participantError } = await supabase
    .from('match_participants')
    .select('match_id, user_id, team, score, time_seconds, points, set_scores')
    .in('match_id', matchIds);

  if (participantError) {
    console.error('Failed to load participants:', participantError.message);
    process.exit(1);
  }

  const participantsByMatch = new Map<string, LegacyParticipant[]>();
  (allParticipants || []).forEach((p) => {
    const current = participantsByMatch.get(p.match_id) || [];
    current.push(p as LegacyParticipant);
    participantsByMatch.set(p.match_id, current);
  });

  // 3. Check for already-migrated fixtures to ensure idempotency
  const { data: existingFixtures } = await supabase
    .from('league_fixtures')
    .select('metadata')
    .not('metadata->migrated_from_legacy_match_id', 'is', null);

  const alreadyMigrated = new Set<string>();
  (existingFixtures || []).forEach((f) => {
    const meta = f.metadata as Record<string, unknown> | null;
    if (meta?.migrated_from_legacy_match_id) {
      alreadyMigrated.add(meta.migrated_from_legacy_match_id as string);
    }
  });

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const match of legacyMatches as LegacyMatch[]) {
    if (alreadyMigrated.has(match.id)) {
      skipped++;
      continue;
    }

    const participants = participantsByMatch.get(match.id) || [];
    const fixtureStatus = mapLegacyStatus(match.status);
    const finalResult = fixtureStatus === 'finalized' ? buildFinalResult(match.winner, participants) : null;

    const startsAt = match.match_date ? new Date(`${match.match_date}T00:00:00Z`).toISOString() : null;

    const metadata: Record<string, unknown> = {
      migrated_from_legacy_match_id: match.id,
      generated: false,
      sport: 'unknown',
    };

    if (finalResult) {
      metadata.final_result = finalResult;
    }

    if (match.notes) {
      metadata.notes = match.notes;
    }

    // Insert fixture
    const { data: fixture, error: fixtureError } = await supabase
      .from('league_fixtures')
      .insert({
        league_id: match.league_id,
        week_number: match.week_number,
        starts_at: startsAt,
        fixture_type: 'league_match',
        status: fixtureStatus,
        metadata,
        created_at: match.created_at,
      })
      .select('id')
      .single();

    if (fixtureError || !fixture) {
      console.error(`Failed to migrate match ${match.id}:`, fixtureError?.message);
      errors++;
      continue;
    }

    // Insert participants
    if (participants.length > 0) {
      const participantRows = participants.map((p) => ({
        fixture_id: fixture.id,
        user_id: p.user_id,
        side: p.team === 'A' || p.team === 'B' ? p.team : null,
        role: 'player',
      }));

      const { error: pError } = await supabase
        .from('league_fixture_participants')
        .insert(participantRows);

      if (pError) {
        console.error(`Failed to migrate participants for match ${match.id}:`, pError.message);
        // Clean up the fixture we just created
        await supabase.from('league_fixtures').delete().eq('id', fixture.id);
        errors++;
        continue;
      }
    }

    migrated++;
  }

  console.log('\nMigration complete:');
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped (already migrated): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log('\nLegacy tables (league_matches, match_participants) are deprecated but NOT dropped.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
