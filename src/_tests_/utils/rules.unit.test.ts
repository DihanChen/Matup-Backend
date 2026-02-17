import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNestedArray,
  getNestedBoolean,
  getNestedNumber,
  getNestedString,
  toRulesObject,
  type RulesObject,
} from '../../utils/rules';

test('toRulesObject returns object values unchanged', () => {
  const rules = { sessions: { enabled: true } };
  assert.deepEqual(toRulesObject(rules), rules);
});

test('toRulesObject returns empty object for non-objects', () => {
  assert.deepEqual(toRulesObject(null), {});
  assert.deepEqual(toRulesObject(undefined), {});
  assert.deepEqual(toRulesObject('rules'), {});
  assert.deepEqual(toRulesObject(42), {});
  assert.deepEqual(toRulesObject([1, 2, 3]), {});
});

test('getNestedBoolean returns boolean value for valid path', () => {
  const obj: RulesObject = { submissions: { require_organizer_approval: true } };
  assert.equal(
    getNestedBoolean(obj, ['submissions', 'require_organizer_approval']),
    true
  );
});

test('getNestedBoolean returns null for missing/invalid values', () => {
  const obj: RulesObject = { submissions: { require_organizer_approval: 'yes' } };
  assert.equal(getNestedBoolean(obj, ['submissions', 'require_organizer_approval']), null);
  assert.equal(getNestedBoolean(obj, ['submissions', 'missing']), null);
  assert.equal(
    getNestedBoolean(obj, ['submissions', 'require_organizer_approval', 'nested']),
    null
  );
});

test('getNestedNumber returns finite numeric values only', () => {
  const obj: RulesObject = {
    points: { win: 3, draw: 1, invalid: Number.NaN, infinite: Number.POSITIVE_INFINITY },
  };

  assert.equal(getNestedNumber(obj, ['points', 'win']), 3);
  assert.equal(getNestedNumber(obj, ['points', 'draw']), 1);
  assert.equal(getNestedNumber(obj, ['points', 'invalid']), null);
  assert.equal(getNestedNumber(obj, ['points', 'infinite']), null);
  assert.equal(getNestedNumber(obj, ['points', 'missing']), null);
});

test('getNestedString returns string values only', () => {
  const obj: RulesObject = { match: { doubles_partner_mode: 'fixed_pairs', max_sets: 3 } };

  assert.equal(getNestedString(obj, ['match', 'doubles_partner_mode']), 'fixed_pairs');
  assert.equal(getNestedString(obj, ['match', 'max_sets']), null);
  assert.equal(getNestedString(obj, ['missing']), null);
});

test('getNestedArray returns arrays and null otherwise', () => {
  const obj: RulesObject = {
    match: {
      fixed_pairs: [
        ['u1', 'u2'],
        ['u3', 'u4'],
      ],
      partner_mode: 'random',
    },
  };

  assert.deepEqual(getNestedArray(obj, ['match', 'fixed_pairs']), [
    ['u1', 'u2'],
    ['u3', 'u4'],
  ]);
  assert.equal(getNestedArray(obj, ['match', 'partner_mode']), null);
  assert.equal(getNestedArray(obj, ['match', 'fixed_pairs', 'nested']), null);
});
