// Wall-clock points on DST transitions resolve per RFC 5545 §3.3.5: a
// nonexistent time (a gap) is pushed forward, a time that occurs twice
// (the fall-back overlap) counts only as its first occurrence — and the
// rare zone that skips a whole day denotes the day that follows.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasMatchIn, matches, occurrencesIn, parse } from '../src/index.ts';

function doc(timezone: string, schedule: Record<string, unknown>, calendar?: Record<string, unknown>) {
  return parse({
    version: '1.0',
    timezone,
    ...(calendar ? { calendar } : {}),
    schedules: [schedule],
  });
}

function strings(occurrences: readonly (Temporal.PlainDate | Temporal.ZonedDateTime)[]): string[] {
  return occurrences.map((occurrence) =>
    occurrence instanceof Temporal.PlainDate
      ? occurrence.toString()
      : occurrence.toString({ timeZoneName: 'never' }),
  );
}

// America/New_York 2026: spring forward Mar 8 02:00→03:00, fall back
// Nov 1 02:00→01:00.
describe('the spring-forward gap', () => {
  it('pushes a nonexistent fixed time forward in real time', () => {
    const d = doc('America/New_York', { days: [8], times: ['02:30'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-03-08T03:30:00-04:00'), true, '02:30 EST read with the pre-transition offset');
    assert.deepEqual(
      strings(occurrencesIn(d, schedule, '2026-03-08T00:00:00-05:00', '2026-03-08T23:59:59-04:00')),
      ['2026-03-08T03:30:00-04:00'],
    );
  });

  it('folds grid points sharing an instant into one point', () => {
    const d = doc('America/New_York', { days: [8], times: { every: [1, 'hour'] } });
    const points = occurrencesIn(d, d.schedules[0]!, '2026-03-08T00:00:00-05:00', '2026-03-08T23:59:59-04:00');

    // 24 wall positions, but 02:00 resolves onto 03:00 — 23 instants.
    assert.equal(points.length, 23);
  });
});

describe('the fall-back overlap', () => {
  it('counts an ambiguous fixed time as its first occurrence only', () => {
    const d = doc('America/New_York', { days: [1], times: ['01:30'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-11-01T01:30:00-04:00'), true, 'the first pass');
    assert.equal(matches(d, schedule, '2026-11-01T01:30:00-05:00'), false, 'the second pass is not a scheduled point');
    assert.deepEqual(
      strings(occurrencesIn(d, schedule, '2026-11-01T00:00:00-04:00', '2026-11-01T23:59:59-05:00')),
      ['2026-11-01T01:30:00-04:00'],
    );
  });

  it('matches an all-day occurrence through both passes of the overlap', () => {
    const d = doc('America/New_York', { days: [1], allday: true });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-11-01T01:30:00-04:00'), true);
    assert.equal(matches(d, schedule, '2026-11-01T01:30:00-05:00'), true, 'the local date is still Nov 1');
  });
});

describe('the interval every across transitions', () => {
  it('keeps the wall-clock row intact over spring forward', () => {
    const d = doc('America/New_York', { from: '2026-03-07 12:00', every: [24, 'hour'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-03-07T12:00:00-05:00', '2026-03-08T12:00:00-04:00')),
      ['2026-03-07T12:00:00-05:00', '2026-03-08T12:00:00-04:00'],
      'a 24-hour wall step is 23 real hours across the gap',
    );
  });

  it('pushes a row point that lands in the gap forward', () => {
    const d = doc('America/New_York', { from: '2026-03-06 02:30', every: [24, 'hour'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-03-08T00:00:00-05:00', '2026-03-08T12:00:00-04:00')),
      ['2026-03-08T03:30:00-04:00'],
    );
  });

  it('reads a row point in the overlap as its first occurrence', () => {
    const d = doc('America/New_York', { from: '2026-10-31 01:30', every: [24, 'hour'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-11-01T00:00:00-04:00', '2026-11-01T12:00:00-05:00')),
      ['2026-11-01T01:30:00-04:00'],
    );
    assert.equal(
      hasMatchIn(d, d.schedules[0]!, '2026-11-01T01:00:00-05:00', '2026-11-01T02:00:00-05:00'),
      false,
      'the second pass of the wall time is not a point',
    );
  });
});

describe('a zone that skips a whole day', () => {
  // Pacific/Apia moved across the date line at the end of 2011-12-29:
  // the calendar day 2011-12-30 never happened.
  it('denotes the day that follows for an all-day occurrence', () => {
    const d = doc('Pacific/Apia', { allday: true }, { date_sets: { moved: ['2011-12-30'] } });
    const withName = doc('Pacific/Apia', { days: ['moved'], allday: true }, { date_sets: { moved: ['2011-12-30'] } });

    assert.deepEqual(
      strings(occurrencesIn(withName, withName.schedules[0]!, '2011-12-28T00:00:00-11:00', '2012-01-02T00:00:00+14:00')),
      ['2011-12-31'],
    );
    assert.ok(d, 'baseline document parses');
  });

  it('collapses two calendar days whose starts resolve to the same instant', () => {
    const d = doc('Pacific/Apia', { days: [30, 31], allday: true });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2011-12-28T00:00:00-11:00', '2012-01-02T00:00:00+14:00')),
      ['2011-12-31'],
      'December 2011 only',
    );
  });
});
