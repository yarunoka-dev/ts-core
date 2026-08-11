// Document-level parsing: input forms, the reading directives (version,
// timezone), the declarations (resolvers), annotations, and the
// validation that needs the whole document — resolvability of every
// name, and the completeness of what the document declares.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { YrnkError } from '../src/error.ts';
import { parse } from '../src/index.ts';

const minimal = {
  version: '1.0',
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

describe('parse input forms', () => {
  it('parses a decoded object', () => {
    const doc = parse(minimal);

    assert.equal(doc.version, '1.0');
    assert.equal(doc.timezone, 'Asia/Tokyo');
    assert.deepEqual(doc.resolvers, []);
    assert.deepEqual(doc.calendar.dateSets, {});
    assert.equal(doc.schedules.length, 1);
  });

  it('parses a JSON string', () => {
    const doc = parse(JSON.stringify(minimal));

    assert.equal(doc.timezone, 'Asia/Tokyo');
  });

  it('rejects JSON that is not an object', () => {
    rejects('[1, 2]', 'invalid-document');
    rejects('"text"', 'invalid-document');
    rejects(42, 'invalid-document');
    rejects(null, 'invalid-document');
  });

  it('rejects malformed JSON text', () => {
    rejects('{not json', 'invalid-document');
  });

  it('rejects unknown keys in the document', () => {
    rejects({ ...minimal, extra: 1 }, 'invalid-document', /extra/);
  });
});

describe('version', () => {
  it('is required and must be a string', () => {
    const { version, ...rest } = minimal;

    rejects(rest, 'invalid-document', /version/);
    rejects({ ...minimal, version: 1.0 }, 'invalid-document', /version/);
  });

  it('rejects a version this implementation does not know', () => {
    rejects({ ...minimal, version: '2.0' }, 'unsupported-version');
    rejects({ ...minimal, version: '1.1' }, 'unsupported-version');
  });
});

describe('timezone', () => {
  it('accepts IANA names including UTC and backward links', () => {
    assert.equal(parse({ ...minimal, timezone: 'UTC' }).timezone, 'UTC');
    assert.equal(parse({ ...minimal, timezone: 'Japan' }).timezone, 'Japan');
  });

  it('rejects fixed offsets', () => {
    rejects({ ...minimal, timezone: '+09:00' }, 'invalid-document', /offset/);
  });

  it('rejects unknown and missing timezones', () => {
    rejects({ ...minimal, timezone: 'Mars/Olympus' }, 'invalid-document');
    rejects({ ...minimal, timezone: 'JST' }, 'invalid-document');

    const { timezone, ...rest } = minimal;

    rejects(rest, 'invalid-document', /timezone/);
  });
});

describe('schedules', () => {
  it('is required, a non-empty list of objects', () => {
    const { schedules, ...rest } = minimal;

    rejects(rest, 'invalid-document', /schedules/);
    rejects({ ...minimal, schedules: [] }, 'invalid-document');
    rejects({ ...minimal, schedules: { times: ['10:00'] } }, 'invalid-document');
    rejects({ ...minimal, schedules: ['x'] }, 'invalid-document');
  });

  it('rejects duplicate schedules regardless of member order', () => {
    rejects(
      {
        ...minimal,
        schedules: [
          { days: [25], times: ['10:00'] },
          { times: ['10:00'], days: [25] },
        ],
      },
      'invalid-document',
      /[Dd]uplicate/,
    );
  });
});

describe('resolvers declarations', () => {
  const resolver = () => ['2026-08-05'];

  it('parses declared names bound by the host', () => {
    const doc = parse(
      {
        ...minimal,
        resolvers: ['closures'],
        schedules: [{ days: ['closures'], times: ['10:00'] }],
      },
      { resolvers: { closures: resolver } },
    );

    assert.deepEqual(doc.resolvers, ['closures']);
  });

  it('rejects an empty or malformed list', () => {
    rejects({ ...minimal, resolvers: [] }, 'invalid-document');
    rejects({ ...minimal, resolvers: 'closures' }, 'invalid-document');
    rejects({ ...minimal, resolvers: [1] }, 'invalid-document');
  });

  it('rejects reserved words and duplicates as declared names', () => {
    assert.throws(
      () => parse({ ...minimal, resolvers: ['holiday'] }, { resolvers: { holiday: resolver } }),
      (error: unknown) => error instanceof YrnkError,
    );
    rejects({ ...minimal, resolvers: ['a-name', 'a-name'] }, 'invalid-document');
  });

  it('rejects a name that is both defined and declared', () => {
    assert.throws(
      () =>
        parse(
          {
            ...minimal,
            resolvers: ['founding-day'],
            calendar: { date_sets: { 'founding-day': ['2026-10-01'] } },
          },
          { resolvers: { 'founding-day': resolver } },
        ),
      (error: unknown) => error instanceof YrnkError && error.code === 'invalid-document',
    );
  });

  it('rejects a used name that is neither defined nor declared', () => {
    rejects(
      {
        ...minimal,
        schedules: [{ days: ['closures'], times: ['10:00'] }],
      },
      'undefined-name',
    );
  });

  it('rejects a declared name with no binding', () => {
    rejects(
      {
        ...minimal,
        resolvers: ['closures'],
      },
      'unregistered-resolver',
    );
  });

  it('accepts a declared and bound name that no schedule uses', () => {
    const doc = parse(
      { ...minimal, resolvers: ['closures'] },
      { resolvers: { closures: resolver } },
    );

    assert.deepEqual(doc.resolvers, ['closures']);
  });
});

describe('document annotations', () => {
  it('carries label and description through', () => {
    const doc = parse({ ...minimal, label: 'Company calendar', description: 'two\nlines' });

    assert.equal(doc.label, 'Company calendar');
    assert.equal(doc.description, 'two\nlines');
  });

  it('rejects invalid annotation values', () => {
    rejects({ ...minimal, label: 42 }, 'invalid-document');
    rejects({ ...minimal, label: '  ' }, 'invalid-document');
    rejects({ ...minimal, label: 'two\nlines' }, 'invalid-document');
    rejects({ ...minimal, description: 'x'.repeat(1001) }, 'invalid-document');
  });
});
