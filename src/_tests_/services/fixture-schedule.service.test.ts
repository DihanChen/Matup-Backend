import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateDoublesAssignedSchedule,
  generateDoublesRandomSchedule,
  generateSinglesSchedule,
} from '../../services/fixture-schedule.service';

test('generateSinglesSchedule creates weekly non-BYE pairings', () => {
  const fixtures = generateSinglesSchedule(['u1', 'u2', 'u3', 'u4'], 3);

  assert.equal(fixtures.length, 6);
  assert.ok(fixtures.every((fixture) => fixture.sideA.length === 1));
  assert.ok(fixtures.every((fixture) => fixture.sideB.length === 1));
  assert.ok(fixtures.every((fixture) => fixture.sideA[0] !== 'BYE'));
  assert.ok(fixtures.every((fixture) => fixture.sideB[0] !== 'BYE'));
});

test('generateDoublesRandomSchedule uses each member once per week when divisible by four', () => {
  const memberIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const fixtures = generateDoublesRandomSchedule(memberIds, 1);

  assert.equal(fixtures.length, 2);
  const seen = new Set(fixtures.flatMap((fixture) => [...fixture.sideA, ...fixture.sideB]));
  assert.equal(seen.size, memberIds.length);
});

test('generateDoublesAssignedSchedule respects fixed team pairs', () => {
  const fixedTeams: Array<[string, string]> = [
    ['u1', 'u2'],
    ['u3', 'u4'],
  ];
  const fixtures = generateDoublesAssignedSchedule(
    ['u1', 'u2', 'u3', 'u4'],
    2,
    fixedTeams
  );

  assert.equal(fixtures.length, 2);
  for (const fixture of fixtures) {
    assert.deepEqual(fixture.sideA, ['u1', 'u2']);
    assert.deepEqual(fixture.sideB, ['u3', 'u4']);
  }
});
