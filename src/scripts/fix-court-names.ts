/**
 * One-time script to fix courts named "Public Court" with proper names
 * derived from reverse geocoding.
 *
 * Usage: npx tsx src/scripts/fix-court-names.ts [--dry-run]
 */

import { supabaseAdmin } from '../utils/supabase';
import {
  reverseGeocode,
  generateCourtName,
  buildGeocodedAddress,
} from '../services/nominatim.service';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Fix court names${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  // Fetch all courts with "Public Court" name
  const { data: courts, error } = await supabaseAdmin
    .from('courts')
    .select('id, name, address, latitude, longitude, sport_types, operator')
    .eq('name', 'Public Court')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch courts:', error.message);
    process.exit(1);
  }

  if (!courts || courts.length === 0) {
    console.log('No courts named "Public Court" found. Nothing to do.');
    return;
  }

  console.log(`Found ${courts.length} courts named "Public Court"\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const court of courts) {
    const result = await reverseGeocode(court.latitude, court.longitude);
    const geocoded = result?.address ?? null;

    const newName = generateCourtName(
      court.sport_types || [],
      court.operator || null,
      geocoded
    );
    const newAddress = buildGeocodedAddress(geocoded) || court.address;

    // Skip if we'd just get another generic name
    if (newName === 'Public Court') {
      console.log(`  SKIP ${court.id} — no better name available`);
      skipped++;
      continue;
    }

    console.log(`  ${court.id}: "${court.name}" → "${newName}"`);
    console.log(`    address: "${court.address}" → "${newAddress}"`);

    if (!DRY_RUN) {
      const { error: updateError } = await supabaseAdmin
        .from('courts')
        .update({ name: newName, address: newAddress })
        .eq('id', court.id);

      if (updateError) {
        console.log(`    FAILED: ${updateError.message}`);
        failed++;
        continue;
      }
    }

    updated++;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
