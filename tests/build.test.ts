// build: the mirror image of parse. Round-tripping a valid document is
// the identity in this language — building what parse returned yields
// the original spelling, structurally.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { build, parse } from '../src/index.ts';

describe('build', () => {
  it('round-trips a minimal document', () => {
    const doc = {
      version: '1.1',
      timezone: 'Asia/Tokyo',
      schedules: [{ times: ['10:00'] }],
    };

    assert.deepEqual(build(parse(doc)), doc);
  });

  it('round-trips every construct at once', () => {
    const doc = {
      label: 'Company calendar',
      description: 'What this document is\nand a second line',
      version: '1.1',
      timezone: 'Asia/Tokyo',
      resolvers: ['yasumi-jp', 'company-closures'],
      calendar: {
        holidays: 'yasumi-jp',
        business_holidays: ['2026-08-13', '2026-08-14'],
        business_days: [],
        workweek: ['tue', 'wed', 'thu', 'fri', 'sat'],
        business_hours: [
          ['09:00', '12:00'],
          ['13:00', '24:00'],
        ],
        date_sets: { 'founding-day': ['2026-10-01'], 'closing-day': [] },
      },
      schedules: [
        {
          label: 'Payday transfer',
          days: [25],
          shift: ['prev', 'or_same', 'business_day'],
          times: ['10:00'],
        },
        {
          days: [['1st', 'fri'], ['3rd', 'fri'], 'last_day_of_month', 'founding-day'],
          if: ['not', 'holiday'],
          times: ['07:30', '19:30'],
        },
        {
          from: '2026-07-01 00:00',
          until: '2026-08-01 00:00',
          years: [2026],
          months: [7],
          times: { every: [90, 'minute'], between: ['08:30', '20:00'] },
        },
        {
          days: ['business_day'],
          times: { every: [1, 'hour'], between: 'business_hour' },
        },
        {
          days: ['weekend'],
          times: { every: [600, 'second'] },
        },
        {
          from: '2026-07-14 00:00',
          days: [['every', 2, 'day']],
          times: ['03:00'],
        },
        { years: [2043], months: [6], days: [15], allday: true },
        { from: '2026-07-17 10:00', every: [36, 'hour'] },
        { if: ['next', 'last_day_of_month'], times: ['09:00'] },
        { days: ['mon'], if: ['prev', 'not', 'sun'], times: ['09:00'] },
      ],
    };

    const bindings = { 'yasumi-jp': () => [], 'company-closures': () => [] };

    assert.deepEqual(build(parse(doc, { resolvers: bindings })), doc);
  });

  it('omits what the document omitted', () => {
    const built = build(
      parse({
        version: '1.1',
        timezone: 'UTC',
        schedules: [{ allday: true }],
      }),
    );

    assert.deepEqual(Object.keys(built), ['version', 'timezone', 'schedules']);
    assert.deepEqual(built.schedules, [{ allday: true }]);
  });

  it('emits an empty written date list as a list, never dropping it', () => {
    const doc = {
      version: '1.1',
      timezone: 'UTC',
      calendar: { holidays: [] },
      schedules: [{ days: ['holiday'], times: ['10:00'] }],
    };

    assert.deepEqual(build(parse(doc)), doc);
  });

  it('round-trips the authored empty objects of a 1.0 document', () => {
    // A serializer keeps the declared spelling: 1.0 may write an empty
    // calendar or date_sets, and round-tripping never rewrites it.
    const empty = {
      version: '1.0',
      timezone: 'UTC',
      calendar: {},
      schedules: [{ allday: true }],
    };

    assert.deepEqual(build(parse(empty)), empty);

    const nested = {
      version: '1.0',
      timezone: 'UTC',
      calendar: { date_sets: {} },
      schedules: [{ allday: true }],
    };

    assert.deepEqual(build(parse(nested)), nested);
  });

  it('copies the input arrays instead of aliasing or freezing them', () => {
    const times = ['10:00'];
    const years = [2026];
    const parsed = parse({ version: '1.1', timezone: 'UTC', schedules: [{ years, times }] });

    times.push('11:00');
    years.push(2027);

    assert.deepEqual(build(parsed), {
      version: '1.1',
      timezone: 'UTC',
      schedules: [{ years: [2026], times: ['10:00'] }],
    });
    assert.ok(!Object.isFrozen(times), 'the caller keeps ownership of its arrays');
  });

  it('is JSON-stringifiable as the wire form', () => {
    const doc = { version: '1.1', timezone: 'UTC', schedules: [{ times: ['10:00'] }] };
    const json = JSON.stringify(build(parse(doc)));

    assert.deepEqual(JSON.parse(json), doc);
  });
});
