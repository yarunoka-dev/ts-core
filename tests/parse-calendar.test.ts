// Calendar parsing: the closed set of reserved keys, the two forms of a
// date-list position (array of literals, or a name), workweek,
// business_hours windows, and the open date_sets namespace.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { YrnkError } from '../src/error.ts';
import { parse } from '../src/index.ts';

const base = {
  version: '1.1',
  timezone: 'Asia/Tokyo',
  schedules: [{ times: ['10:00'] }],
};

function rejects(input: unknown, code: string, pattern?: RegExp): void {
  assert.throws(
    () => parse(input),
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

describe('calendar structure', () => {
  it('rejects non-objects and unknown keys', () => {
    rejects({ ...base, calendar: [] }, 'invalid-document');
    rejects({ ...base, calendar: 'holidays' }, 'invalid-document');
    rejects({ ...base, calendar: { holiday: [] } }, 'invalid-document', /holiday/);
  });

  it('rejects an empty calendar object', () => {
    rejects({ ...base, calendar: {} }, 'invalid-document', /calendar/);
  });

  it('rejects an empty date_sets object', () => {
    rejects({ ...base, calendar: { date_sets: {} } }, 'invalid-document', /date_sets/);
  });

  it('parses the empty objects of a 1.0 document as all-undefined', () => {
    // Validity follows the declared version: the 1.1 restriction never
    // rejects a document declaring 1.0.
    const doc = parse({ ...base, version: '1.0', calendar: {} });

    assert.equal(doc.calendar.holidays, undefined);
    assert.equal(doc.calendar.workweek, undefined);
    assert.deepEqual(doc.calendar.dateSets, {});

    const nested = parse({ ...base, version: '1.0', calendar: { date_sets: {} } });

    assert.deepEqual(nested.calendar.dateSets, {});
  });
});

describe('date-list positions', () => {
  it('parses a written date list in written order', () => {
    const doc = parse({ ...base, calendar: { holidays: ['2026-01-12', '2026-01-01'] } });

    assert.deepEqual(doc.calendar.holidays, ['2026-01-12', '2026-01-01']);
  });

  it('accepts an explicit empty list', () => {
    const doc = parse({ ...base, calendar: { holidays: [] } });

    assert.deepEqual(doc.calendar.holidays, []);
  });

  it('parses a name where a date list is expected', () => {
    // The name is used and not defined, so it must also be declared.
    const doc = parse(
      { ...base, resolvers: ['yasumi-jp'], calendar: { holidays: 'yasumi-jp' } },
      { resolvers: { 'yasumi-jp': () => [] } },
    );

    assert.equal(doc.calendar.holidays, 'yasumi-jp');
  });

  it('rejects a bare date-shaped string (it is not a one-date list)', () => {
    rejects({ ...base, calendar: { holidays: '2026-01-01' } }, 'invalid-document');
  });

  it('rejects malformed and nonexistent dates', () => {
    rejects({ ...base, calendar: { holidays: ['2026/01/01'] } }, 'invalid-document');
    rejects({ ...base, calendar: { holidays: ['2026-1-1'] } }, 'invalid-document');
    rejects({ ...base, calendar: { holidays: ['2026-02-30'] } }, 'invalid-document');
    rejects({ ...base, calendar: { holidays: [20260101] } }, 'invalid-document');
  });

  it('rejects duplicate dates', () => {
    rejects({ ...base, calendar: { holidays: ['2026-01-01', '2026-01-01'] } }, 'invalid-document');
  });

  it('rejects a reserved word as the name', () => {
    rejects({ ...base, calendar: { holidays: 'holiday' } }, 'reserved-name');
  });

  it('rejects a used name that is neither defined nor declared', () => {
    rejects({ ...base, calendar: { holidays: 'yasumi-jp' } }, 'undefined-name');
  });
});

describe('workweek', () => {
  it('parses day names in written order', () => {
    const doc = parse({ ...base, calendar: { workweek: ['tue', 'mon'] } });

    assert.deepEqual(doc.calendar.workweek, ['tue', 'mon']);
  });

  it('rejects unknown day names, empties, and duplicates', () => {
    rejects({ ...base, calendar: { workweek: ['monday'] } }, 'invalid-document');
    rejects({ ...base, calendar: { workweek: [] } }, 'invalid-document');
    rejects({ ...base, calendar: { workweek: ['mon', 'mon'] } }, 'invalid-document');
  });
});

describe('business_hours', () => {
  it('parses window pairs and keeps 24:00 as an end', () => {
    const doc = parse({
      ...base,
      calendar: {
        business_hours: [
          ['09:00', '12:00'],
          ['13:00', '24:00'],
        ],
      },
    });

    assert.deepEqual(doc.calendar.businessHours, [
      ['09:00', '12:00'],
      ['13:00', '24:00'],
    ]);
  });

  it('rejects start >= end and 24:00 as a start', () => {
    rejects({ ...base, calendar: { business_hours: [['12:00', '09:00']] } }, 'invalid-document');
    rejects({ ...base, calendar: { business_hours: [['09:00', '09:00']] } }, 'invalid-document');
    rejects({ ...base, calendar: { business_hours: [['24:00', '24:00']] } }, 'invalid-document');
  });

  it('rejects overlapping windows but allows touching ones', () => {
    rejects(
      {
        ...base,
        calendar: {
          business_hours: [
            ['09:00', '12:00'],
            ['11:00', '13:00'],
          ],
        },
      },
      'invalid-document',
    );
    parse({
      ...base,
      calendar: {
        business_hours: [
          ['09:00', '12:00'],
          ['12:00', '13:00'],
        ],
      },
    });
  });

  it('rejects malformed windows and empties', () => {
    rejects({ ...base, calendar: { business_hours: [] } }, 'invalid-document');
    rejects({ ...base, calendar: { business_hours: [['09:00']] } }, 'invalid-document');
    rejects({ ...base, calendar: { business_hours: ['09:00-12:00'] } }, 'invalid-document');
    rejects({ ...base, calendar: { business_hours: [['9:00', '12:00']] } }, 'invalid-document');
  });
});

describe('date_sets', () => {
  it('parses the open namespace', () => {
    const doc = parse({
      ...base,
      calendar: { date_sets: { 'founding-day': ['2026-10-01'], 'closing-day': [] } },
    });

    assert.deepEqual(doc.calendar.dateSets, {
      'founding-day': ['2026-10-01'],
      'closing-day': [],
    });
  });

  it('rejects reserved and literal-shaped keys', () => {
    rejects({ ...base, calendar: { date_sets: { holiday: [] } } }, 'reserved-name');
    rejects({ ...base, calendar: { date_sets: { '42': [] } } }, 'reserved-name');
    rejects({ ...base, calendar: { date_sets: { '2026-01-01': [] } } }, 'reserved-name');
  });

  it('keeps __proto__ an ordinary entry rather than a prototype write', () => {
    // Through JSON, as a real document arrives — a JS object literal
    // would itself send __proto__ to the prototype slot.
    const doc = parse(
      '{"version":"1.1","timezone":"Asia/Tokyo","calendar":{"date_sets":{"__proto__":["2026-10-01"]}},"schedules":[{"days":["__proto__"],"allday":true}]}',
    );

    assert.ok(Object.hasOwn(doc.calendar.dateSets, '__proto__'));
    // Read as an own property: an index or dot read would go through the
    // deprecated accessor this test exists to avoid.
    assert.deepEqual(Object.getOwnPropertyDescriptor(doc.calendar.dateSets, '__proto__')?.value, [
      '2026-10-01',
    ]);
    assert.equal(Object.getPrototypeOf(doc.calendar.dateSets), Object.prototype);
  });

  it('rejects values that are not date lists (a name cannot stand for another name)', () => {
    rejects({ ...base, calendar: { date_sets: { alias: 'other-name' } } }, 'invalid-document');
    rejects({ ...base, calendar: { date_sets: { alias: null } } }, 'invalid-document');
  });
});

describe('calendar vocabulary requirements', () => {
  it('requires holidays for the holiday word', () => {
    rejects(
      { ...base, schedules: [{ days: ['holiday'], times: ['10:00'] }] },
      'missing-calendar-data',
    );
    parse({
      ...base,
      calendar: { holidays: [] },
      schedules: [{ days: ['holiday'], times: ['10:00'] }],
    });
  });

  it('requires all three layers for the business words', () => {
    rejects(
      {
        ...base,
        calendar: { holidays: [], business_holidays: [] },
        schedules: [{ days: ['business_day'], times: ['10:00'] }],
      },
      'missing-calendar-data',
    );
    parse({
      ...base,
      calendar: { holidays: [], business_holidays: [], business_days: [] },
      schedules: [{ days: ['business_day'], times: ['10:00'] }],
    });
  });

  it('weekday and weekend need no definitions', () => {
    parse({ ...base, schedules: [{ days: ['weekday'], times: ['10:00'] }] });
    parse({ ...base, schedules: [{ days: ['weekend'], times: ['10:00'] }] });
  });

  it('requires business_hours for between business_hour', () => {
    rejects(
      {
        ...base,
        schedules: [{ times: { every: [1, 'hour'], between: 'business_hour' } }],
      },
      'missing-calendar-data',
    );
  });
});
