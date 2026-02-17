import assert from 'node:assert/strict';
import test from 'node:test';
import { toIsoOrNull, weekEndIso, weekStartIso } from '../../utils/league-dates';

test('weekStartIso returns null when startDate is null or invalid', () => {
  assert.equal(weekStartIso(null, 1), null);
  assert.equal(weekStartIso('not-a-date', 1), null);
});

test('weekStartIso offsets by week number using 7-day increments', () => {
  assert.equal(weekStartIso('2026-02-01', 1), '2026-02-01T12:00:00.000Z');
  assert.equal(weekStartIso('2026-02-01', 2), '2026-02-08T12:00:00.000Z');
  assert.equal(weekStartIso('2026-02-01', 4), '2026-02-22T12:00:00.000Z');
});

test('weekEndIso returns null for empty/invalid startsAt values', () => {
  assert.equal(weekEndIso(null), null);
  assert.equal(weekEndIso('invalid'), null);
});

test('weekEndIso returns two-hour offset when startsAt is valid', () => {
  assert.equal(weekEndIso('2026-02-01T12:00:00.000Z'), '2026-02-01T14:00:00.000Z');
});

test('toIsoOrNull parses valid date strings and rejects invalid/empty values', () => {
  assert.equal(toIsoOrNull('2026-02-16T10:30:00Z'), '2026-02-16T10:30:00.000Z');
  assert.equal(toIsoOrNull('2026-02-16'), '2026-02-16T00:00:00.000Z');
  assert.equal(toIsoOrNull(''), null);
  assert.equal(toIsoOrNull('   '), null);
  assert.equal(toIsoOrNull(123), null);
  assert.equal(toIsoOrNull('not-a-date'), null);
});
