// The three queries over ordinary calendars: the judgment at a point
// (matches), the judgment over a period (hasMatchIn), and the
// enumeration (occurrencesIn), with the boundary conventions of each.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasMatchIn, matches, occurrencesIn, parse } from '../src/index.ts';

function doc(schedule: Record<string, unknown>, calendar?: Record<string, unknown>) {
  return parse({
    version: '1.0',
    timezone: 'Asia/Tokyo',
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

describe('matches', () => {
  it('answers instant equality for a timed occurrence', () => {
    const d = doc({ days: [25], times: ['10:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-25T10:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-25T01:00:00Z'), true, 'the same instant in another offset');
    assert.equal(matches(d, schedule, '2026-07-25T10:00:01+09:00'), false);
    assert.equal(matches(d, schedule, '2026-07-24T10:00:00+09:00'), false);
  });

  it('ignores anything finer than a second', () => {
    const d = doc({ days: [25], times: ['10:00'] });

    assert.equal(matches(d, d.schedules[0]!, '2026-07-25T10:00:00.750+09:00'), true);
  });

  it('accepts Date, Temporal.Instant, and Temporal.ZonedDateTime inputs', () => {
    const d = doc({ days: [25], times: ['10:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, new Date('2026-07-25T01:00:00Z')), true);
    assert.equal(matches(d, schedule, Temporal.Instant.from('2026-07-25T01:00:00Z')), true);
    assert.equal(
      matches(d, schedule, Temporal.ZonedDateTime.from('2026-07-25T10:00:00+09:00[Asia/Tokyo]')),
      true,
    );
  });

  it('matches an all-day occurrence on every instant of its day', () => {
    const d = doc({ days: [25], allday: true });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-25T00:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-25T23:59:59+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-24T23:59:59+09:00'), false);
    assert.equal(matches(d, schedule, '2026-07-25T15:00:00Z'), false, 'read on the document timezone, that is already the 26th');
  });

  it('reads a day number that a month does not have as no match, never a rollover', () => {
    const d = doc({ days: [31], times: ['10:00'] });

    assert.equal(matches(d, d.schedules[0]!, '2026-05-01T10:00:00+09:00'), false);
  });
});

describe('date axes and atoms', () => {
  it('combines years, months, and days with AND', () => {
    const d = doc({ years: [2043], months: [6], days: [15], allday: true });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2043-06-15T12:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2044-06-15T12:00:00+09:00'), false);
    assert.equal(matches(d, schedule, '2043-07-15T12:00:00+09:00'), false);
  });

  it('combines atoms within days with OR', () => {
    const d = doc({ days: ['sat', 'sun'], times: ['09:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-25T09:00:00+09:00'), true, 'a Saturday');
    assert.equal(matches(d, schedule, '2026-07-26T09:00:00+09:00'), true, 'a Sunday');
    assert.equal(matches(d, schedule, '2026-07-27T09:00:00+09:00'), false, 'a Monday');
  });

  it('matches ordinal weekdays and last_day_of_month', () => {
    const d = doc({ days: [['3rd', 'mon'], 'last_day_of_month'], times: ['10:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-20T10:00:00+09:00'), true, 'the third Monday of July 2026');
    assert.equal(matches(d, schedule, '2026-07-13T10:00:00+09:00'), false, 'the second Monday');
    assert.equal(matches(d, schedule, '2026-07-31T10:00:00+09:00'), true, 'the last day');
    assert.equal(matches(d, schedule, '2026-02-28T10:00:00+09:00'), true, 'the last day of a short month');
    assert.equal(matches(d, schedule, '2026-02-27T10:00:00+09:00'), false);
  });

  it('matches last weekday tuples from the end of the month', () => {
    const d = doc({ days: [['last', 'fri']], times: ['10:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-31T10:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-24T10:00:00+09:00'), false);
  });

  it('a 5th tuple in a month without a fifth week simply does not match', () => {
    const d = doc({ days: [['5th', 'fri']], times: ['10:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-31T10:00:00+09:00'), true, 'July 2026 has five Fridays');
    assert.deepEqual(
      strings(occurrencesIn(d, schedule, '2026-06-01T00:00:00+09:00', '2026-06-30T23:59:59+09:00')),
      [],
      'June 2026 has only four',
    );
  });

  it('matches names against date sets', () => {
    const d = doc(
      { days: ['founding-day'], allday: true },
      { date_sets: { 'founding-day': ['2026-10-01'] } },
    );
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-10-01T00:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-10-02T00:00:00+09:00'), false);
  });
});

describe('day cycle', () => {
  it('counts every Nth day from the from date as day one', () => {
    const d = doc({ from: '2026-07-14 00:00', days: [['every', 2, 'day']], times: ['03:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-14T03:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-15T03:00:00+09:00'), false);
    assert.equal(matches(d, schedule, '2026-07-16T03:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-08-01T03:00:00+09:00'), true, '18 days after, still on the cycle');
  });

  it('clips the day the validity starts by its time', () => {
    // from at 12:00 with times 03:00: the from day's 03:00 is out of
    // range, so the first point is two days later.
    const d = doc({ from: '2026-07-14 12:00', days: [['every', 2, 'day']], times: ['03:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-14T03:00:00+09:00'), false);
    assert.equal(matches(d, schedule, '2026-07-16T03:00:00+09:00'), true);
  });

  it('keeps counting across excluded months without resetting', () => {
    const d = doc({
      from: '2026-01-01 00:00',
      months: [3],
      days: [['every', 7, 'day']],
      times: ['09:00'],
    });
    const schedule = d.schedules[0]!;

    // Day one is 1/1; the 7-day row hits 3/5, 3/12, … in March.
    assert.equal(matches(d, schedule, '2026-03-05T09:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-03-04T09:00:00+09:00'), false);
    assert.equal(matches(d, schedule, '2026-01-08T09:00:00+09:00'), false, 'January is filtered out');
  });
});

describe('shift and if', () => {
  const businessCalendar = {
    holidays: ['2026-07-20'],
    business_holidays: [],
    business_days: [],
  };

  it('moves the payday to the previous business day', () => {
    // 2026-07-25 is a Saturday; the previous business day is Friday the
    // 24th.
    const d = doc({ days: [25], shift: ['prev', 'or_same', 'business_day'], times: ['10:00'] }, businessCalendar);
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-24T10:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-25T10:00:00+09:00'), false);
    // 2026-08-25 is a Tuesday: or_same keeps the day itself.
    assert.equal(matches(d, schedule, '2026-08-25T10:00:00+09:00'), true);
  });

  it('reads the strict form as the other meaning, not a default', () => {
    // Without or_same, a Tuesday the 25th moves to Monday the 24th.
    const d = doc({ days: [25], shift: ['prev', 'business_day'], times: ['10:00'] }, businessCalendar);
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-08-25T10:00:00+09:00'), false);
    assert.equal(matches(d, schedule, '2026-08-24T10:00:00+09:00'), true);
  });

  it('collapses consecutive base days landing on the same day', () => {
    // Sat 25th and Sun 26th both land on Friday the 24th: one occurrence.
    const d = doc({ days: [25, 26], shift: ['prev', 'or_same', 'business_day'], times: ['10:00'] }, businessCalendar);
    const schedule = d.schedules[0]!;

    assert.deepEqual(
      strings(occurrencesIn(d, schedule, '2026-07-01T00:00:00+09:00', '2026-07-31T23:59:59+09:00')),
      ['2026-07-24T10:00:00+09:00'],
    );
  });

  it('lets the landing day leave the month and the year', () => {
    // New Year's Eve 2027 is a Friday; holidays on 1/1 push the next
    // business day of a 12/31 base into January… use a Saturday base:
    // 2028-12-31 is a Sunday, shifted next business day lands 2029-01-01 (a Monday).
    const d = doc({ months: [12], days: [31], shift: ['next', 'or_same', 'business_day'], times: ['09:00'] }, businessCalendar);
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2029-01-01T09:00:00+09:00'), true);
    assert.equal(
      hasMatchIn(d, schedule, '2028-12-31T00:00:00+09:00', '2029-01-02T00:00:00+09:00'),
      true,
      'found although the base month is outside the period',
    );
  });

  it('if filters without moving, before shift moves', () => {
    // Fridays that are the 13th.
    const d = doc({ days: [13], if: ['fri'], times: ['09:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-02-13T09:00:00+09:00'), true, 'Friday the 13th');
    assert.equal(matches(d, schedule, '2026-07-13T09:00:00+09:00'), false, 'a Monday 13th');
  });

  it('if consults a neighbour with a direction', () => {
    // The last business day before a closed stretch.
    const d = doc(
      { days: ['business_day'], if: ['next', 'business_holiday'], times: ['08:00'] },
      businessCalendar,
    );
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-17T08:00:00+09:00'), true, 'Friday before the holiday Monday 7/20');
    assert.equal(matches(d, schedule, '2026-07-16T08:00:00+09:00'), false);
  });

  it('if not skips without moving', () => {
    const d = doc({ days: ['mon'], if: ['not', 'holiday'], times: ['09:00'] }, businessCalendar);
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-13T09:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-20T09:00:00+09:00'), false, 'the holiday Monday is skipped, not moved');
  });
});

describe('the layer model', () => {
  const calendar = {
    holidays: ['2026-07-20', '2026-07-23'],
    business_holidays: ['2026-07-21'],
    business_days: ['2026-07-23', '2026-07-25'],
    workweek: ['mon', 'tue', 'wed', 'thu', 'fri'],
  };

  function business(d: ReturnType<typeof doc>, at: string): boolean {
    return matches(d, d.schedules[0]!, at);
  }

  it('decides business_day top-down with early return', () => {
    const d = doc({ days: ['business_day'], allday: true }, calendar);

    assert.equal(business(d, '2026-07-22T00:00:00+09:00'), true, 'an ordinary Wednesday');
    assert.equal(business(d, '2026-07-20T00:00:00+09:00'), false, 'a public holiday');
    assert.equal(business(d, '2026-07-21T00:00:00+09:00'), false, 'an organization closure');
    assert.equal(business(d, '2026-07-23T00:00:00+09:00'), true, 'business_days overrides the holiday below it');
    assert.equal(business(d, '2026-07-25T00:00:00+09:00'), true, 'business_days overrides the weekly pattern');
    assert.equal(business(d, '2026-07-26T00:00:00+09:00'), false, 'an ordinary Sunday');
  });

  it('keeps weekday and weekend on the fixed calendar', () => {
    const shifted = { ...calendar, workweek: ['tue', 'wed', 'thu', 'fri', 'sat'] };
    const d = doc({ days: ['weekday'], allday: true }, shifted);

    assert.equal(business(d, '2026-07-27T00:00:00+09:00'), true, 'Monday stays a weekday whatever the workweek says');

    const e = doc({ days: ['business_holiday'], allday: true }, shifted);

    assert.equal(matches(e, e.schedules[0]!, '2026-07-27T00:00:00+09:00'), true, 'and also a business holiday');
  });

  it('keeps holiday on the holidays list alone', () => {
    const d = doc({ days: ['holiday'], allday: true }, calendar);

    assert.equal(business(d, '2026-07-23T00:00:00+09:00'), true, 'a working day, but still a holiday');
  });
});

describe('times expansion', () => {
  it('lays the grid anchored at the window start', () => {
    const d = doc({ days: [14], times: { every: [1, 'hour'], between: ['08:30', '11:00'] } });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-14T00:00:00+09:00', '2026-07-14T23:59:59+09:00')),
      ['2026-07-14T08:30:00+09:00', '2026-07-14T09:30:00+09:00', '2026-07-14T10:30:00+09:00'],
    );
  });

  it('excludes the window end', () => {
    const d = doc({ days: [14], times: { every: [4, 'hour'], between: ['08:00', '20:00'] } });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-14T00:00:00+09:00', '2026-07-14T23:59:59+09:00')),
      ['2026-07-14T08:00:00+09:00', '2026-07-14T12:00:00+09:00', '2026-07-14T16:00:00+09:00'],
    );
  });

  it('re-anchors per window over business hours', () => {
    const d = doc(
      { days: [14], times: { every: [2, 'hour'], between: 'business_hour' } },
      { business_hours: [['09:00', '12:00'], ['13:00', '16:00']] },
    );

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-14T00:00:00+09:00', '2026-07-14T23:59:59+09:00')),
      ['2026-07-14T09:00:00+09:00', '2026-07-14T11:00:00+09:00', '2026-07-14T13:00:00+09:00', '2026-07-14T15:00:00+09:00'],
    );
  });

  it('re-anchors per day over the whole day', () => {
    const d = doc({ times: { every: [7, 'hour'] } });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-14T00:00:00+09:00', '2026-07-15T08:00:00+09:00')),
      [
        '2026-07-14T00:00:00+09:00', '2026-07-14T07:00:00+09:00', '2026-07-14T14:00:00+09:00',
        '2026-07-14T21:00:00+09:00', '2026-07-15T00:00:00+09:00', '2026-07-15T07:00:00+09:00',
      ],
    );
  });
});

describe('hasMatchIn', () => {
  it('excludes the start and includes the end', () => {
    const d = doc({ days: [25], times: ['10:00'] });
    const schedule = d.schedules[0]!;

    assert.equal(hasMatchIn(d, schedule, '2026-07-25T10:00:00+09:00', '2026-07-26T00:00:00+09:00'), false);
    assert.equal(hasMatchIn(d, schedule, '2026-07-25T09:59:59+09:00', '2026-07-25T10:00:00+09:00'), true);
  });

  it('answers an empty or inverted period with no', () => {
    const d = doc({ times: { every: [1, 'second'] } });
    const schedule = d.schedules[0]!;

    assert.equal(hasMatchIn(d, schedule, '2026-07-25T10:00:00+09:00', '2026-07-25T10:00:00+09:00'), false);
    assert.equal(hasMatchIn(d, schedule, '2026-07-25T10:00:01+09:00', '2026-07-25T10:00:00+09:00'), false);
  });

  it('counts an all-day occurrence while its day overlaps the period', () => {
    const d = doc({ days: [25], allday: true });
    const schedule = d.schedules[0]!;

    assert.equal(hasMatchIn(d, schedule, '2026-07-25T22:00:00+09:00', '2026-07-25T23:00:00+09:00'), true, 'a day is due for as long as it lasts');
    assert.equal(hasMatchIn(d, schedule, '2026-07-26T00:00:00+09:00', '2026-07-27T00:00:00+09:00'), false);
    assert.equal(hasMatchIn(d, schedule, '2026-07-24T00:00:00+09:00', '2026-07-25T00:00:00+09:00'), true, 'the period end touches the day start');
  });

  it('spans months without missing distant occurrences', () => {
    const d = doc({ months: [1], days: [1], times: ['00:00'] });

    assert.equal(hasMatchIn(d, d.schedules[0]!, '2026-02-01T00:00:00+09:00', '2026-12-31T23:59:59+09:00'), false);
    assert.equal(hasMatchIn(d, d.schedules[0]!, '2026-02-01T00:00:00+09:00', '2027-01-01T00:00:00+09:00'), true);
  });
});

describe('occurrencesIn', () => {
  it('includes both boundary instants', () => {
    const d = doc({ days: [25], times: ['10:00', '12:00'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-25T10:00:00+09:00', '2026-07-25T12:00:00+09:00')),
      ['2026-07-25T10:00:00+09:00', '2026-07-25T12:00:00+09:00'],
    );
  });

  it('answers all-day occurrences as dates', () => {
    const d = doc({ days: ['sat'], allday: true });
    const occurrences = occurrencesIn(d, d.schedules[0]!, '2026-07-01T00:00:00+09:00', '2026-07-15T00:00:00+09:00');

    assert.ok(occurrences.every((occurrence) => occurrence instanceof Temporal.PlainDate));
    assert.deepEqual(strings(occurrences), ['2026-07-04', '2026-07-11']);
  });

  it('keeps an all-day occurrence whose day merely overlaps the range', () => {
    const d = doc({ days: [14], allday: true });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-14T12:00:00+09:00', '2026-07-14T13:00:00+09:00')),
      ['2026-07-14'],
    );
  });

  it('answers in ascending instant order across multiple times', () => {
    const d = doc({ days: [1, 2], times: ['23:00', '01:00'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-01T00:00:00+09:00', '2026-07-03T00:00:00+09:00')),
      [
        '2026-07-01T01:00:00+09:00', '2026-07-01T23:00:00+09:00',
        '2026-07-02T01:00:00+09:00', '2026-07-02T23:00:00+09:00',
      ],
    );
  });
});

describe('from / until clipping', () => {
  it('clips timed points to [from, until)', () => {
    const d = doc({ from: '2026-07-01 09:00', until: '2026-07-03 09:00', times: ['09:00'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-06-01T00:00:00+09:00', '2026-08-01T00:00:00+09:00')),
      ['2026-07-01T09:00:00+09:00', '2026-07-02T09:00:00+09:00'],
      'a point at from is included; a point at until is not',
    );
  });

  it('keeps an all-day occurrence while its day overlaps the validity range', () => {
    const d = doc({ from: '2026-07-14 12:00', days: [14, 15], allday: true });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-01T00:00:00+09:00', '2026-08-01T00:00:00+09:00')),
      ['2026-07-14', '2026-07-15'],
      'the 14th is still partly inside',
    );
  });
});

describe('the interval every', () => {
  it('lays points from + k × interval across days', () => {
    const d = doc({ from: '2026-07-17 10:00', every: [7, 'hour'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-17T10:00:00+09:00', '2026-07-18T08:00:00+09:00')),
      ['2026-07-17T10:00:00+09:00', '2026-07-17T17:00:00+09:00', '2026-07-18T00:00:00+09:00', '2026-07-18T07:00:00+09:00'],
    );
  });

  it('lands on non-zero seconds with a second unit', () => {
    const d = doc({ from: '2026-07-17 10:00', every: [90, 'second'] });

    assert.deepEqual(
      strings(occurrencesIn(d, d.schedules[0]!, '2026-07-17T10:00:00+09:00', '2026-07-17T10:04:00+09:00')),
      ['2026-07-17T10:00:00+09:00', '2026-07-17T10:01:30+09:00', '2026-07-17T10:03:00+09:00'],
    );
  });

  it('judges points by instant equality in matches', () => {
    const d = doc({ from: '2026-07-14 00:00', every: [36, 'hour'] });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-07-14T00:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-15T12:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-07-15T00:00:00+09:00'), false);
  });

  it('answers a period far from the anchor without walking to it', () => {
    const d = doc({ from: '2026-01-01 00:00', every: [1, 'second'] });

    assert.equal(hasMatchIn(d, d.schedules[0]!, '2043-06-15T00:00:00+09:00', '2043-06-15T00:00:01+09:00'), true);
  });
});
