// The date domain: evaluation works over 0001-01-01 through 9999-12-31,
// read on the document timezone's clock, and ends at the edges rather
// than failing — recurrences generate only their intersection with the
// domain, a shift search that leaves it finds no landing, an if
// neighbour outside it fails the guard, and a query is answered on its
// overlap with the domain.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasMatchIn, matches, occurrencesIn, parse } from '../src/index.ts';

function doc(schedule: Record<string, unknown>, timezone = 'UTC') {
  return parse({ version: '1.1', timezone, schedules: [schedule] });
}

function strings(occurrences: readonly (Temporal.PlainDate | Temporal.ZonedDateTime)[]): string[] {
  return occurrences.map((occurrence) =>
    occurrence instanceof Temporal.PlainDate
      ? occurrence.toString()
      : occurrence.toString({ timeZoneName: 'never' }),
  );
}

describe('recurrences end at the domain', () => {
  it('generates no sequence point on a day past 9999-12-31', () => {
    const d = doc({ from: '9999-12-31 23:00', every: [30, 'minute'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '9999-12-31T22:00:00Z', '+010000-01-01T02:00:00Z')),
      ['9999-12-31T23:00:00+00:00', '9999-12-31T23:30:00+00:00'],
    );
  });

  it('generates no matching day before 0001-01-01', () => {
    const d = doc({ years: [1], months: [1], days: [1], allday: true });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '0000-12-30T00:00:00Z', '0001-01-02T00:00:00Z')),
      ['0001-01-01'],
    );
  });
});

describe('the modifiers at the edges', () => {
  it('finds no landing when the shift search leaves the domain', () => {
    // 9999-12-31 is a Friday; the next Monday lies past the edge, so
    // the base day produces no occurrences — the same fate as running
    // out of the 366-day cap, never an error.
    const d = doc({
      years: [9999],
      months: [12],
      days: [31],
      shift: ['next', 'mon'],
      allday: true,
    });

    assert.equal(
      hasMatchIn(d, d.schedules[0]!, '9999-12-01T00:00:00Z', '+010000-01-08T00:00:00Z'),
      false,
    );
  });

  it('fails the guard when the if neighbour lies outside the domain', () => {
    // 10000-01-01 is no day, so the guard fails — and it fails before
    // not applies: "no such day" is not a falsehood for not to invert.
    const plain = doc({
      years: [9999],
      months: [12],
      days: [31],
      if: ['next', 'weekday'],
      allday: true,
    });
    // Without the domain edge, 10000-01-01 would read as a Saturday
    // and "not sun" would hold.
    const negated = doc({
      years: [9999],
      months: [12],
      days: [31],
      if: ['next', 'not', 'sun'],
      allday: true,
    });

    assert.equal(matches(plain, plain.schedules[0]!, '9999-12-31T12:00:00Z'), false);
    assert.equal(matches(negated, negated.schedules[0]!, '9999-12-31T12:00:00Z'), false);
  });

  it('fails the guard at the lower edge too', () => {
    // Without the domain edge, 0000-12-31 would read as a Sunday and
    // "not mon" would hold; the guard fails on "no such day" instead.
    const d = doc({ years: [1], months: [1], days: [1], if: ['prev', 'not', 'mon'], allday: true });

    assert.equal(matches(d, d.schedules[0]!, '0001-01-01T12:00:00Z'), false);
  });
});

describe('queries against the domain', () => {
  it('answers a query lying entirely outside the domain with empty, never an error', () => {
    const d = doc({ days: [1], allday: true });

    assert.deepEqual(
      occurrencesIn(d, d.schedules[0]!, '+010000-01-02T00:00:00Z', '+010000-01-05T00:00:00Z'),
      [],
    );
    assert.equal(
      hasMatchIn(d, d.schedules[0]!, '+010000-01-02T00:00:00Z', '+010000-01-05T00:00:00Z'),
      false,
    );
  });

  it('answers false for a point judgment outside the domain', () => {
    const d = doc({ days: [1], allday: true });

    assert.equal(matches(d, d.schedules[0]!, '+010000-01-01T12:00:00Z'), false);
    assert.equal(matches(d, d.schedules[0]!, '0000-12-31T12:00:00Z'), false);
  });

  it('keeps an occurrence whose instant exceeds the domain by the zone offset', () => {
    // The bound is on the day, read on the document timezone's clock:
    // 9999-12-31 23:00 in a UTC-12 zone is a year-10000 instant, and it
    // is not lost to the cut.
    const d = doc({ years: [9999], months: [12], days: [31], times: ['23:00'] }, 'Etc/GMT+12');

    assert.deepEqual(
      strings(
        occurrencesIn(d, d.schedules[0]!, '+010000-01-01T00:00:00Z', '+010000-01-01T12:00:00Z'),
      ),
      ['9999-12-31T23:00:00-12:00'],
    );
    assert.equal(matches(d, d.schedules[0]!, '+010000-01-01T11:00:00Z'), true);
  });
});

describe('the 1.0 counts under the domain', () => {
  it('collapses an over-bound count to the anchor alone', () => {
    // Evaluation semantics are one: the closed domain reaches documents
    // declaring 1.0, whose over-bound counts stay valid and mean a
    // single occurrence at the anchor.
    const cycle = parse({
      version: '1.0',
      timezone: 'UTC',
      schedules: [
        { from: '2026-07-14 00:00', days: [['every', 3652059, 'day']], times: ['03:00'] },
      ],
    });
    const sequence = parse({
      version: '1.0',
      timezone: 'UTC',
      schedules: [{ from: '2026-07-14 00:00', every: [315537897600, 'second'] }],
    });

    assert.deepEqual(
      strings(
        occurrencesIn(cycle, cycle.schedules[0]!, '2026-01-01T00:00:00Z', '9999-12-31T23:59:59Z'),
      ),
      ['2026-07-14T03:00:00+00:00'],
    );
    assert.deepEqual(
      strings(
        occurrencesIn(
          sequence,
          sequence.schedules[0]!,
          '2026-01-01T00:00:00Z',
          '9999-12-31T23:59:59Z',
        ),
      ),
      ['2026-07-14T00:00:00+00:00'],
    );
  });
});
