// Resolvers: how dynamic data enters a document. Bindings are handed to
// parse, consulted per question, and validated at the moment they
// answer.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ensureResolvable, matches, occurrencesIn, parse, YrnkError } from '../src/index.ts';

const base = {
  version: '1.0',
  timezone: 'Asia/Tokyo',
  resolvers: ['closures'],
  schedules: [{ days: ['closures'], allday: true }],
};

describe('resolver evaluation', () => {
  it('consults the binding and matches its dates', () => {
    const d = parse(base, { resolvers: { closures: () => ['2026-08-05'] } });
    const schedule = d.schedules[0]!;

    assert.equal(matches(d, schedule, '2026-08-05T12:00:00+09:00'), true);
    assert.equal(matches(d, schedule, '2026-08-06T12:00:00+09:00'), false);
  });

  it('asks for the year the consulted day falls in', () => {
    const ranges: string[] = [];
    const d = parse(base, {
      resolvers: {
        closures: ({ from, through }) => {
          ranges.push(`${from.toString()}..${through.toString()}`);

          return [];
        },
      },
    });

    matches(d, d.schedules[0]!, '2026-08-05T12:00:00+09:00');

    assert.deepEqual(ranges, ['2026-01-01..2026-12-31']);
  });

  it('resolves per question rather than caching across them', () => {
    let calls = 0;
    const d = parse(base, {
      resolvers: {
        closures: () => {
          calls++;

          return ['2026-08-05'];
        },
      },
    });
    const schedule = d.schedules[0]!;

    matches(d, schedule, '2026-08-05T12:00:00+09:00');
    matches(d, schedule, '2026-08-05T12:00:00+09:00');

    assert.equal(calls, 2, 'each question resolves anew');
  });

  it('rejects a resolver answer that violates the contract', () => {
    const wrongShape = parse(base, {
      resolvers: { closures: (() => 'not-a-list') as unknown as () => string[] },
    });
    const wrongDates = parse(base, {
      resolvers: { closures: () => ['08/05/2026'] },
    });

    for (const d of [wrongShape, wrongDates]) {
      assert.throws(
        () => matches(d, d.schedules[0]!, '2026-08-05T12:00:00+09:00'),
        (error: unknown) => error instanceof YrnkError && error.code === 'invalid-calendar-data',
      );
    }
  });

  it('backs calendar definitions by name', () => {
    const d = parse({
      version: '1.0',
      timezone: 'Asia/Tokyo',
      resolvers: ['yasumi-jp'],
      calendar: { holidays: 'yasumi-jp' },
      schedules: [{ days: ['holiday'], allday: true }],
    }, { resolvers: { 'yasumi-jp': () => ['2026-01-01'] } });

    assert.equal(matches(d, d.schedules[0]!, '2026-01-01T12:00:00+09:00'), true);
    assert.equal(matches(d, d.schedules[0]!, '2026-01-02T12:00:00+09:00'), false);
  });

  it('cuts nothing from the answered range itself', () => {
    // The kit's static bindings answer the whole list whatever the range
    // asked; dates outside the consulted year are simply never asked
    // about.
    const d = parse(base, { resolvers: { closures: () => ['2026-08-05', '2027-08-05'] } });

    assert.deepEqual(
      occurrencesIn(d, d.schedules[0]!, '2026-01-01T00:00:00+09:00', '2026-12-31T23:59:59+09:00')
        .map(String),
      ['2026-08-05'],
    );
  });
});

describe('ensureResolvable', () => {
  it('passes a well-wired document and answers nothing', () => {
    const d = parse(base, { resolvers: { closures: () => [] } });

    assert.equal(ensureResolvable(d), undefined);
  });

  it('never invokes a resolver', () => {
    let calls = 0;
    const d = parse(base, {
      resolvers: {
        closures: () => {
          calls++;

          return [];
        },
      },
    });

    ensureResolvable(d);

    assert.equal(calls, 0, 'passing says the references are answerable, not what the answers will be');
  });
});
