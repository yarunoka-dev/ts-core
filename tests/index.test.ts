// The package entry point exposes the field-level validation helpers:
// an editor can validate a single value (a name, an annotation, a date
// literal, a timezone, a time literal, a window) and get exactly the
// message the parser would produce. Each helper is called once — the
// rules themselves are pinned by the home modules' own tests.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  dateLiteralProblem,
  descriptionProblem,
  isTimeLiteral,
  labelProblem,
  nameProblem,
  RESERVED_WORDS,
  timezoneProblem,
  windowProblem,
} from '../src/index.ts';

describe('the field-level validation surface', () => {
  it('exposes the problem helpers', () => {
    assert.equal(nameProblem('founding-day'), null);
    assert.equal(labelProblem('Payday transfer'), null);
    assert.equal(descriptionProblem('Runs on the last business day.'), null);
    assert.equal(dateLiteralProblem('2026-01-01'), null);
    assert.equal(timezoneProblem('Asia/Tokyo'), null);
    assert.equal(windowProblem('09:00', '17:00'), null);
  });

  it('exposes the time-literal guard', () => {
    assert.equal(isTimeLiteral('09:30'), true);
  });

  it('exposes the reserved word list', () => {
    assert.equal(RESERVED_WORDS.includes('weekday'), true);
  });
});
