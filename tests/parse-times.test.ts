// The rules a time window [start, end) is held to, on its own values:
// start is zero-padded HH:MM, end is HH:MM or the end-of-day token
// "24:00", and start is strictly before end (a window crossing midnight
// cannot be written).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTimeLiteral, windowProblem } from '../src/parse/times.ts';

describe('isTimeLiteral', () => {
  it('accepts zero-padded HH:MM times', () => {
    assert.equal(isTimeLiteral('00:00'), true);
    assert.equal(isTimeLiteral('09:30'), true);
    assert.equal(isTimeLiteral('23:59'), true);
  });

  it('rejects the end-of-day token', () => {
    assert.equal(isTimeLiteral('24:00'), false);
  });

  it('rejects unpadded and out-of-range spellings', () => {
    assert.equal(isTimeLiteral('9:30'), false);
    assert.equal(isTimeLiteral('09:60'), false);
    assert.equal(isTimeLiteral('25:00'), false);
    assert.equal(isTimeLiteral(''), false);
  });
});

describe('windowProblem', () => {
  it('accepts an ordinary window', () => {
    assert.equal(windowProblem('09:00', '17:00'), null);
  });

  it('accepts "24:00" as the end', () => {
    assert.equal(windowProblem('00:00', '24:00'), null);
  });

  it('rejects a start that is not a time literal', () => {
    assert.notEqual(windowProblem('9:00', '17:00'), null);
    assert.notEqual(windowProblem('24:00', '24:00'), null);
  });

  it('rejects an end that is neither a time literal nor "24:00"', () => {
    assert.notEqual(windowProblem('09:00', '24:30'), null);
    assert.notEqual(windowProblem('09:00', '17'), null);
  });

  it('rejects an empty window and a window crossing midnight', () => {
    assert.notEqual(windowProblem('09:00', '09:00'), null);
    assert.notEqual(windowProblem('17:00', '09:00'), null);
  });
});
