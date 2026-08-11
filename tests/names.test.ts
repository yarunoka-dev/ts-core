// The rules a name is held to, wherever one is written: no reserved
// words, no literal shapes (digits only, time-shaped, date-shaped), and
// at least one non-whitespace character.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nameProblem } from '../src/names.ts';

describe('nameProblem', () => {
  it('accepts ordinary names', () => {
    assert.equal(nameProblem('founding-day'), null);
    assert.equal(nameProblem('yasumi-jp'), null);
    assert.equal(nameProblem('休業日'), null);
  });

  it('rejects empty and whitespace-only strings', () => {
    assert.notEqual(nameProblem(''), null);
    assert.notEqual(nameProblem('   '), null);
    assert.notEqual(nameProblem('　'), null);
  });

  it('rejects every reserved word', () => {
    for (const word of [
      'weekday', 'weekend', 'holiday', 'business_day', 'business_holiday', 'business_hour',
      'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
      '1st', '2nd', '3rd', '4th', '5th', 'last',
      'last_day_of_month',
      'not', 'prev', 'next', 'or_same',
      'hour', 'minute', 'second', 'day',
      'version', 'timezone', 'resolvers', 'calendar', 'schedules',
      'years', 'months', 'days', 'shift', 'if', 'times', 'allday', 'every', 'between', 'from', 'until',
      'holidays', 'business_holidays', 'business_days', 'workweek', 'business_hours', 'date_sets',
      'label', 'description',
    ]) {
      assert.notEqual(nameProblem(word), null, `expected "${word}" to be rejected`);
    }
  });

  it('rejects literal shapes', () => {
    assert.notEqual(nameProblem('42'), null, 'digits only');
    assert.notEqual(nameProblem('09:00'), null, 'time-shaped');
    assert.notEqual(nameProblem('2026-01-01'), null, 'date-shaped');
  });

  it('accepts names that merely contain literal-like parts', () => {
    assert.equal(nameProblem('team42'), null);
    assert.equal(nameProblem('2026-holidays'), null);
  });
});
