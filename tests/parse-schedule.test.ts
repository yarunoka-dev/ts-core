// Schedule parsing: the date axes, the day atoms, the modifiers (shift,
// if), the three time parts (exactly one required), and the validity
// range — each parsed into its discriminated-union node.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { YrnkError } from '../src/error.ts';
import type { YrnkSchedule } from '../src/index.ts';
import { parse } from '../src/index.ts';

const base = {
  version: '1.1',
  timezone: 'Asia/Tokyo',
};

function one(schedule: Record<string, unknown>, calendar?: Record<string, unknown>): YrnkSchedule {
  const doc = parse({ ...base, ...(calendar ? { calendar } : {}), schedules: [schedule] });
  const parsed = doc.schedules[0];

  assert.ok(parsed);

  return parsed;
}

function rejects(schedule: Record<string, unknown>, code: string, pattern?: RegExp): void {
  assert.throws(
    () => parse({ ...base, schedules: [schedule] }),
    (error: unknown) => {
      assert.ok(error instanceof YrnkError, `expected YrnkError, got ${String(error)}`);
      assert.equal(error.code, code);

      if (pattern) {
        assert.match(error.message, pattern);
      }

      return true;
    },
  );
}

describe('schedule structure', () => {
  it('rejects unknown keys', () => {
    rejects({ times: ['10:00'], extra: 1 }, 'invalid-document', /extra/);
  });

  it('requires exactly one of times, allday, every', () => {
    rejects({}, 'invalid-document');
    rejects({ times: ['10:00'], allday: true }, 'invalid-document');
    rejects({ from: '2026-07-14 00:00', every: [1, 'hour'], times: ['10:00'] }, 'invalid-document');
  });

  it('accepts allday only as true', () => {
    assert.deepEqual(one({ allday: true }).time, { kind: 'allday' });
    rejects({ allday: false }, 'invalid-document');
    rejects({ allday: 1 }, 'invalid-document');
  });
});

describe('date axes', () => {
  it('parses years and months', () => {
    const schedule = one({ years: [2043], months: [6, 12], days: [15], times: ['10:00'] });

    assert.deepEqual(schedule.years, [2043]);
    assert.deepEqual(schedule.months, [6, 12]);
  });

  it('rejects out-of-range, duplicated, empty, and non-integer axes', () => {
    rejects({ years: [0], times: ['10:00'] }, 'invalid-document');
    rejects({ years: [10000], times: ['10:00'] }, 'invalid-document');
    rejects({ months: [13], times: ['10:00'] }, 'invalid-document');
    rejects({ months: [1, 1], times: ['10:00'] }, 'invalid-document');
    rejects({ months: [], times: ['10:00'] }, 'invalid-document');
    rejects({ months: [1.5], times: ['10:00'] }, 'invalid-document');
    rejects({ months: 2, times: ['10:00'] }, 'invalid-document');
  });
});

describe('day atoms', () => {
  it('parses each atom form into its node', () => {
    const schedule = one(
      {
        days: [25, 'mon', ['3rd', 'fri'], 'last_day_of_month', 'business_day', 'founding-day'],
        times: ['10:00'],
      },
      { holidays: [], business_holidays: [], business_days: [], date_sets: { 'founding-day': [] } },
    );

    assert.deepEqual(schedule.days, [
      { kind: 'month-day', day: 25 },
      { kind: 'weekday', day: 'mon' },
      { kind: 'ordinal-weekday', ordinal: '3rd', day: 'fri' },
      { kind: 'last-day-of-month' },
      { kind: 'calendar-word', word: 'business_day' },
      { kind: 'name', name: 'founding-day' },
    ]);
  });

  it('parses the day cycle and requires from', () => {
    const schedule = one({
      from: '2026-07-14 00:00',
      days: [['every', 2, 'day']],
      times: ['03:00'],
    });

    assert.deepEqual(schedule.days, [{ kind: 'day-cycle', interval: 2 }]);
    rejects({ days: [['every', 2, 'day']], times: ['03:00'] }, 'invalid-document', /from/);
  });

  it('rejects out-of-range day numbers and scalar days', () => {
    rejects({ days: [0], times: ['10:00'] }, 'invalid-document');
    rejects({ days: [32], times: ['10:00'] }, 'invalid-document');
    rejects({ days: 'mon', times: ['10:00'] }, 'invalid-document');
    rejects({ days: [], times: ['10:00'] }, 'invalid-document');
  });

  it('rejects misplaced words and literal shapes', () => {
    rejects({ days: ['3rd'], times: ['10:00'] }, 'invalid-document', /tuple/);
    rejects({ days: ['not'], times: ['10:00'] }, 'invalid-document');
    rejects({ days: ['business_hour'], times: ['10:00'] }, 'invalid-document');
    rejects({ days: ['2026-10-01'], times: ['10:00'] }, 'invalid-document', /date_sets/);
    rejects({ days: ['25'], times: ['10:00'] }, 'invalid-document');
    rejects({ days: ['09:00'], times: ['10:00'] }, 'invalid-document');
  });

  it('rejects malformed tuples and duplicates', () => {
    rejects({ days: [['3rd']], times: ['10:00'] }, 'invalid-document');
    rejects({ days: [['3rd', 'mon', 'x']], times: ['10:00'] }, 'invalid-document');
    rejects({ days: [['6th', 'mon']], times: ['10:00'] }, 'invalid-document');
    rejects({ days: [['3rd', 'monday']], times: ['10:00'] }, 'invalid-document');
    rejects({ days: [25, 25], times: ['10:00'] }, 'invalid-document', /[Dd]uplicate/);
    rejects(
      {
        days: [
          ['3rd', 'mon'],
          ['3rd', 'mon'],
        ],
        times: ['10:00'],
      },
      'invalid-document',
      /[Dd]uplicate/,
    );
  });
});

describe('shift', () => {
  it('parses both forms', () => {
    assert.deepEqual(
      one(
        { days: [25], shift: ['prev', 'business_day'], times: ['10:00'] },
        { holidays: [], business_holidays: [], business_days: [] },
      ).shift,
      {
        direction: 'prev',
        orSame: false,
        condition: { kind: 'calendar-word', word: 'business_day' },
      },
    );
    assert.deepEqual(
      one({ days: [25], shift: ['next', 'or_same', 'mon'], times: ['10:00'] }).shift,
      {
        direction: 'next',
        orSame: true,
        condition: { kind: 'weekday', day: 'mon' },
      },
    );
  });

  it('rejects malformed shifts', () => {
    rejects({ days: [25], shift: ['sideways', 'mon'], times: ['10:00'] }, 'invalid-document');
    rejects({ days: [25], shift: ['prev'], times: ['10:00'] }, 'invalid-document');
    rejects({ days: [25], shift: ['prev', 'almost', 'mon'], times: ['10:00'] }, 'invalid-document');
    rejects(
      { days: [25], shift: ['prev', ['every', 2, 'day']], times: ['10:00'] },
      'invalid-document',
    );
  });
});

describe('if', () => {
  it('parses the four forms', () => {
    assert.deepEqual(one({ days: [13], if: ['fri'], times: ['10:00'] }).if, {
      direction: null,
      negated: false,
      condition: { kind: 'weekday', day: 'fri' },
    });
    assert.deepEqual(
      one({ days: ['mon'], if: ['not', 'holiday'], times: ['10:00'] }, { holidays: [] }).if,
      {
        direction: null,
        negated: true,
        condition: { kind: 'calendar-word', word: 'holiday' },
      },
    );
    assert.deepEqual(one({ if: ['next', 'last_day_of_month'], times: ['10:00'] }).if, {
      direction: 'next',
      negated: false,
      condition: { kind: 'last-day-of-month' },
    });
    assert.deepEqual(one({ days: ['mon'], if: ['prev', 'not', 'sun'], times: ['10:00'] }).if, {
      direction: 'prev',
      negated: true,
      condition: { kind: 'weekday', day: 'sun' },
    });
  });

  it('rejects malformed guards', () => {
    rejects({ if: [], times: ['10:00'] }, 'invalid-document');
    rejects({ if: ['maybe', 'mon'], times: ['10:00'] }, 'invalid-document');
    rejects({ if: ['not', 'not', 'mon'], times: ['10:00'] }, 'invalid-document');
    rejects({ if: [['every', 2, 'day']], times: ['10:00'] }, 'invalid-document');
  });
});

describe('times', () => {
  it('parses fixed times in written order', () => {
    assert.deepEqual(one({ times: ['20:00', '08:00'] }).time, {
      kind: 'times',
      times: ['20:00', '08:00'],
    });
  });

  it('rejects malformed and duplicate times', () => {
    rejects({ times: [] }, 'invalid-document');
    rejects({ times: ['8:00'] }, 'invalid-document');
    rejects({ times: ['24:00'] }, 'invalid-document');
    rejects({ times: ['10:60'] }, 'invalid-document');
    rejects({ times: ['10:00:00'] }, 'invalid-document');
    rejects({ times: [600] }, 'invalid-document');
    rejects({ times: ['10:00', '10:00'] }, 'invalid-document', /[Dd]uplicate/);
  });

  it('parses the clock grid', () => {
    assert.deepEqual(one({ times: { every: [90, 'minute'], between: ['08:30', '20:00'] } }).time, {
      kind: 'grid',
      every: [90, 'minute'],
      between: ['08:30', '20:00'],
    });
    assert.deepEqual(one({ times: { every: [600, 'second'] } }).time, {
      kind: 'grid',
      every: [600, 'second'],
      between: null,
    });
    assert.deepEqual(
      one(
        { times: { every: [1, 'hour'], between: 'business_hour' } },
        { business_hours: [['09:00', '18:00']] },
      ).time,
      {
        kind: 'grid',
        every: [1, 'hour'],
        between: 'business_hour',
      },
    );
  });

  it('rejects malformed grids', () => {
    rejects({ times: { between: ['08:00', '20:00'] } }, 'invalid-document', /every/);
    rejects({ times: { every: [1, 'hour'], extra: 1 } }, 'invalid-document');
    rejects({ times: { every: [0, 'hour'] } }, 'invalid-document');
    rejects({ times: { every: [1, 'hours'] } }, 'invalid-document');
    rejects({ times: { every: [1, 'day'] } }, 'invalid-document');
    rejects({ times: { every: [1, 'hour'], between: 'lunch' } }, 'invalid-document');
    rejects({ times: { every: [1, 'hour'], between: ['20:00', '08:00'] } }, 'invalid-document');
  });

  it('caps the grid count at one day per unit', () => {
    parse({ ...base, schedules: [{ times: { every: [24, 'hour'] } }] });
    parse({ ...base, schedules: [{ times: { every: [1440, 'minute'] } }] });
    parse({ ...base, schedules: [{ times: { every: [86400, 'second'] } }] });
    rejects({ times: { every: [25, 'hour'] } }, 'invalid-document');
    rejects({ times: { every: [1441, 'minute'] } }, 'invalid-document');
    rejects({ times: { every: [86401, 'second'] } }, 'invalid-document');
  });
});

describe('the interval every', () => {
  it('parses with its required from', () => {
    const schedule = one({ from: '2026-07-14 00:00', every: [36, 'hour'] });

    assert.deepEqual(schedule.time, { kind: 'sequence', every: [36, 'hour'] });
    assert.equal(schedule.from, '2026-07-14 00:00');
  });

  it('requires from', () => {
    rejects({ every: [36, 'hour'] }, 'invalid-document', /from/);
  });

  it('rejects the day unit and the date axes', () => {
    rejects({ from: '2026-07-14 00:00', every: [2, 'day'] }, 'invalid-document');
    rejects({ from: '2026-07-14 00:00', every: [1, 'hour'], days: ['mon'] }, 'invalid-document');
    rejects(
      { from: '2026-07-14 00:00', every: [1, 'hour'], shift: ['prev', 'mon'] },
      'invalid-document',
    );
  });
});

describe('the count bounds', () => {
  it('accepts each maximum count and rejects one beyond it', () => {
    // For each unit, the largest count whose second matching day or
    // point stays inside the date domain when from sits at its lower
    // end.
    one({ from: '2026-07-14 00:00', days: [['every', 3652058, 'day']], times: ['03:00'] });
    rejects(
      { from: '2026-07-14 00:00', days: [['every', 3652059, 'day']], times: ['03:00'] },
      'invalid-document',
      /at most/,
    );
    one({ from: '2026-07-14 00:00', every: [87649415, 'hour'] });
    rejects({ from: '2026-07-14 00:00', every: [87649416, 'hour'] }, 'invalid-document', /at most/);
    one({ from: '2026-07-14 00:00', every: [5258964959, 'minute'] });
    rejects(
      { from: '2026-07-14 00:00', every: [5258964960, 'minute'] },
      'invalid-document',
      /at most/,
    );
    one({ from: '2026-07-14 00:00', every: [315537897599, 'second'] });
    rejects(
      { from: '2026-07-14 00:00', every: [315537897600, 'second'] },
      'invalid-document',
      /at most/,
    );
  });

  it('leaves the counts of a document declaring 1.0 unbounded', () => {
    // Validity follows the declared version. Under the closed date
    // domain an over-bound count means the from day alone.
    const doc = parse({
      ...base,
      version: '1.0',
      schedules: [
        { from: '2026-07-14 00:00', days: [['every', 3652059, 'day']], times: ['03:00'] },
        { from: '2026-07-14 00:00', every: [315537897600, 'second'] },
      ],
    });

    assert.equal(doc.schedules.length, 2);
  });
});

describe('from / until', () => {
  it('parses the single literal form', () => {
    const schedule = one({ from: '2026-07-01 00:00', until: '2026-08-01 00:00', times: ['09:00'] });

    assert.equal(schedule.from, '2026-07-01 00:00');
    assert.equal(schedule.until, '2026-08-01 00:00');
  });

  it('rejects every other spelling', () => {
    rejects({ from: '2026-07-01', times: ['09:00'] }, 'invalid-document');
    rejects({ from: '2026-07-01 24:00', times: ['09:00'] }, 'invalid-document');
    rejects({ from: '2026-07-01 09:00:00', times: ['09:00'] }, 'invalid-document');
    rejects({ from: '2026-07-01T09:00', times: ['09:00'] }, 'invalid-document');
    rejects({ from: '2026-2-1 09:00', times: ['09:00'] }, 'invalid-document');
    rejects({ from: '2026-02-30 09:00', times: ['09:00'] }, 'invalid-document');
    rejects({ from: 20260701, times: ['09:00'] }, 'invalid-document');
  });

  it('requires from earlier than until as instants', () => {
    rejects(
      { from: '2026-07-01 10:00', until: '2026-07-01 10:00', times: ['09:00'] },
      'invalid-document',
    );
    rejects(
      { from: '2026-07-02 00:00', until: '2026-07-01 00:00', times: ['09:00'] },
      'invalid-document',
    );
  });
});

describe('schedule annotations', () => {
  it('carries them through and validates them', () => {
    const schedule = one({ label: 'Payday transfer', times: ['10:00'] });

    assert.equal(schedule.label, 'Payday transfer');
    rejects({ label: '', times: ['10:00'] }, 'invalid-document');
    rejects({ description: 42, times: ['10:00'] }, 'invalid-document');
  });
});
