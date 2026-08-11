import { YrnkError } from './error.ts';
import type {
  YrnkCalendar,
  YrnkCalendarWord,
  YrnkDayAtom,
  YrnkResolver,
  YrnkSchedule,
} from './model.ts';

/**
 * Checks schedules against the definitions and validates that every
 * reference resolves — never a silent "no match". Shared by parse (on
 * the whole document) and the queries (before every evaluation).
 */
export function ensureReferencesResolvable(
  schedules: Iterable<YrnkSchedule>,
  calendar: YrnkCalendar,
  bindings: ReadonlyMap<string, YrnkResolver>,
): void {
  for (const schedule of schedules) {
    for (const atom of atomsOf(schedule)) {
      if (atom.kind === 'name' && !resolves(atom.name, calendar, bindings)) {
        throw new YrnkError('undefined-name', `Undefined name: ${atom.name}`);
      }

      if (atom.kind === 'calendar-word') {
        ensureCalendarWordDefined(atom.word, calendar);
      }
    }

    if (
      schedule.time.kind === 'grid' &&
      schedule.time.between === 'business_hour' &&
      calendar.businessHours === undefined
    ) {
      throw new YrnkError(
        'missing-calendar-data',
        'Using business_hour requires the business_hours definition',
      );
    }
  }

  for (const [context, name] of calendarNameReferences(calendar)) {
    if (!resolves(name, calendar, bindings)) {
      throw new YrnkError(
        'unregistered-resolver',
        `No resolver is bound to this name (${context}): ${name}`,
      );
    }
  }
}

/**
 * Every name the schedules and the calendar write, as [context, name]
 * pairs. The holder of a whole document reads this to check its
 * declarations against what it actually uses; nothing here needs a
 * binding to be enumerated, which is what lets a document be read before
 * its bindings exist.
 */
export function* namesUsedIn(
  schedules: Iterable<YrnkSchedule>,
  calendar: YrnkCalendar,
): Generator<readonly [string, string]> {
  yield* calendarNameReferences(calendar);

  for (const schedule of schedules) {
    for (const atom of atomsOf(schedule)) {
      if (atom.kind === 'name') {
        yield ['days', atom.name];
      }
    }
  }
}

/**
 * A name denotes a date set, resolved either inside the document (an
 * entry of date_sets) or outside it (a binding the host supplies). Which
 * of the two makes no difference to where the name may be written, so
 * both are consulted wherever one is checked.
 */
function resolves(
  name: string,
  calendar: YrnkCalendar,
  bindings: ReadonlyMap<string, YrnkResolver>,
): boolean {
  return Object.hasOwn(calendar.dateSets, name) || bindings.has(name);
}

function ensureCalendarWordDefined(word: YrnkCalendarWord, calendar: YrnkCalendar): void {
  const required: readonly (readonly [string, unknown])[] =
    word === 'holiday'
      ? [['holidays', calendar.holidays]]
      : word === 'business_day' || word === 'business_holiday'
        ? [
            ['holidays', calendar.holidays],
            ['business_holidays', calendar.businessHolidays],
            ['business_days', calendar.businessDays],
          ]
        : [];

  const missing = required.filter(([, definition]) => definition === undefined).map(([key]) => key);

  if (missing.length > 0) {
    throw new YrnkError(
      'missing-calendar-data',
      `Using ${word} requires the ${missing.join(
        ', ',
      )} definition (write an empty list if there are no such days)`,
    );
  }
}

function* atomsOf(schedule: YrnkSchedule): Generator<YrnkDayAtom> {
  yield* schedule.days ?? [];

  if (schedule.shift !== undefined) {
    yield schedule.shift.condition;
  }

  if (schedule.if !== undefined) {
    yield schedule.if.condition;
  }
}

/**
 * The names written where a calendar date list is expected. An entry of
 * date_sets is not among them: it carries its dates itself.
 */
function* calendarNameReferences(calendar: YrnkCalendar): Generator<readonly [string, string]> {
  for (const [key, definition] of [
    ['holidays', calendar.holidays],
    ['business_holidays', calendar.businessHolidays],
    ['business_days', calendar.businessDays],
  ] as const) {
    if (typeof definition === 'string') {
      yield [key, definition];
    }
  }
}
