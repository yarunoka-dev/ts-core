import { YrnkError } from '../error.ts';
import type { YrnkCalendar, YrnkDateSet, YrnkResolver } from '../model.ts';
import { timeToSeconds } from '../parse/times.ts';
import { dateLiteralProblem } from '../temporal.ts';
import { denote } from './days.ts';

/**
 * Resolution of the definitions for one question. A resolver is asked
 * for the year a consulted day falls in, and the answer is held until
 * the question is done — the working data of a single computation, not a
 * cache: a new question resolves anew, so a caller that wants results
 * kept holds them in its own resolver.
 */
export type ResolvedCalendar = {
  holidayContains(day: Temporal.PlainDate): boolean;
  businessHolidayContains(day: Temporal.PlainDate): boolean;
  businessDayContains(day: Temporal.PlainDate): boolean;
  nameContains(name: string, day: Temporal.PlainDate): boolean;
  isInWorkweek(isoDayOfWeek: number): boolean;
  businessHourWindows(): readonly (readonly [number, number])[];
};

export function createResolvedCalendar(
  calendar: YrnkCalendar,
  timezone: string,
  bindings: ReadonlyMap<string, YrnkResolver>,
): ResolvedCalendar {
  // Resolved date sets: definition or name → (year | 'all') → the set of
  // denoted ISO dates. A written date list stands whole under 'all'; a
  // resolver's answer is held per consulted year.
  const sets = new Map<string, Map<number | 'all', Set<string>>>();
  let workweekSet: Set<number> | null = null;

  function setOfLiterals(key: string, literals: readonly string[]): Set<string> {
    const cached = sets.get(key)?.get('all');

    if (cached) {
      return cached;
    }

    // Literals are denoted onto the document's clock, so a date a zone
    // skipped reads as the day the occurrence would stand on.
    const set = new Set(
      literals.map((date) => denote(Temporal.PlainDate.from(date), timezone).toString()),
    );

    upsert(key, 'all', set);

    return set;
  }

  function upsert(key: string, scope: number | 'all', set: Set<string>): void {
    const scopes = sets.get(key) ?? new Map<number | 'all', Set<string>>();

    scopes.set(scope, set);
    sets.set(key, scopes);
  }

  /**
   * What a name denotes. One namespace with two ways of resolving: an
   * entry of date_sets carries the list itself, and anything else is
   * left to the binding the host supplies.
   */
  function named(name: string, day: Temporal.PlainDate): Set<string> {
    const entry = calendar.dateSets[name];

    if (entry !== undefined) {
      return setOfLiterals(name, entry);
    }

    const resolver = bindings.get(name);

    if (resolver === undefined) {
      throw new YrnkError('unregistered-resolver', `No resolver is bound to this name: ${name}`);
    }

    const scope = day.year;
    const cached = sets.get(name)?.get(scope);

    if (cached) {
      return cached;
    }

    const answered = resolver({
      from: new Temporal.PlainDate(scope, 1, 1),
      through: new Temporal.PlainDate(scope, 12, 31),
    });
    const set = answeredSetOf(answered, name);

    upsert(name, scope, set);

    return set;
  }

  /**
   * The set a resolver handed back. The value crossed the boundary from
   * host code, so what the contract says it is has to be checked rather
   * than assumed.
   */
  function answeredSetOf(answered: unknown, name: string): Set<string> {
    if (!Array.isArray(answered)) {
      throw new YrnkError(
        'invalid-calendar-data',
        `${name}: the resolver must return a list of date strings`,
      );
    }

    const set = new Set<string>();

    for (const date of answered) {
      if (typeof date !== 'string') {
        throw new YrnkError('invalid-calendar-data', `${name}: dates must be YYYY-MM-DD strings`);
      }

      const problem = dateLiteralProblem(date);

      if (problem !== null) {
        throw new YrnkError('invalid-calendar-data', `${name}: ${problem}`);
      }

      set.add(denote(Temporal.PlainDate.from(date), timezone).toString());
    }

    return set;
  }

  /** The set to consult for this day, for a built-in definition. */
  function dateSet(
    key: string,
    definition: YrnkDateSet | undefined,
    day: Temporal.PlainDate,
  ): Set<string> {
    if (definition === undefined) {
      // A safeguard: the reference validation should have rejected this
      // already.
      throw new YrnkError('missing-calendar-data', `The ${key} definition is required`);
    }

    if (typeof definition === 'string') {
      return named(definition, day);
    }

    return setOfLiterals(key, definition);
  }

  return {
    holidayContains: (day) => dateSet('holidays', calendar.holidays, day).has(day.toString()),
    businessHolidayContains: (day) =>
      dateSet('business_holidays', calendar.businessHolidays, day).has(day.toString()),
    businessDayContains: (day) =>
      dateSet('business_days', calendar.businessDays, day).has(day.toString()),

    nameContains(name, day) {
      if (calendar.dateSets[name] === undefined && !bindings.has(name)) {
        throw new YrnkError('undefined-name', `Undefined name: ${name}`);
      }

      return named(name, day).has(day.toString());
    },

    isInWorkweek(isoDayOfWeek) {
      if (workweekSet === null) {
        const names = calendar.workweek ?? ['mon', 'tue', 'wed', 'thu', 'fri'];
        const iso: Readonly<Record<string, number>> = {
          mon: 1,
          tue: 2,
          wed: 3,
          thu: 4,
          fri: 5,
          sat: 6,
          sun: 7,
        };

        workweekSet = new Set(names.map((name) => iso[name] ?? 0));
      }

      return workweekSet.has(isoDayOfWeek);
    },

    businessHourWindows() {
      if (calendar.businessHours === undefined) {
        throw new YrnkError(
          'missing-calendar-data',
          'Using business_hour requires the business_hours definition',
        );
      }

      return calendar.businessHours.map(
        (window) =>
          [
            timeToSeconds(window[0]),
            window[1] === '24:00' ? 86400 : timeToSeconds(window[1]),
          ] as const,
      );
    },
  };
}
