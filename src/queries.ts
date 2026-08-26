import { bindingsOf } from './bindings.ts';
import { YrnkError } from './error.ts';
import { createFinder } from './eval/match-finder.ts';
import { createResolvedCalendar } from './eval/resolved-calendar.ts';
import type { YrnkDocument, YrnkOccurrence, YrnkSchedule } from './model.ts';
import { ensureReferencesResolvable } from './references.ts';
import { ensureTemporal } from './temporal.ts';

/**
 * An instant a query accepts: a Temporal value, a Date, or an ISO 8601
 * string with a UTC offset. The wire carries moments — a zone-name-only
 * string names no moment and is rejected.
 */
export type YrnkInstant = Temporal.Instant | Temporal.ZonedDateTime | Date | string;

/**
 * Is the given instant an occurrence of this schedule? For a timed
 * occurrence the answer is instant equality — the given instant,
 * ignoring anything finer than a second (no scheduled point is finer),
 * equals the occurrence's instant. An all-day occurrence matches on the
 * day alone: yes for every instant whose local date, read in the
 * document timezone, is that day.
 *
 * Questions are asked per schedule; the top-level OR of the schedules
 * list is composed by the caller (any for the judgments, a merge for the
 * enumeration).
 */
export function matches(document: YrnkDocument, schedule: YrnkSchedule, at: YrnkInstant): boolean {
  ensureTemporal();
  ensureResolvable(document, [schedule]);

  return finderFor(document).matchesAt(schedule, floorSec(toEpochNs(at, 'at')));
}

/**
 * Is there a scheduled point after `after`, through `through`? The
 * substance of a firing decision — "is there a scheduled point after the
 * previous run, through now?" maps onto it directly. A point exactly at
 * `after` does not count (it was the previous judgment's "now", already
 * counted); a point exactly at `through` counts in this judgment. An
 * all-day occurrence counts while its day overlaps the period, however
 * late in the day it is asked: a day is due for as long as it lasts.
 *
 * `after` must not lie after `through`: a reversed period arises only
 * from broken caller state or a clock that moved backwards, and a false
 * would hide exactly that, so it throws a malformed-query error
 * instead. Equal endpoints are legal — (t, t] holds no instant and
 * answers false.
 */
export function hasMatchIn(
  document: YrnkDocument,
  schedule: YrnkSchedule,
  after: YrnkInstant,
  through: YrnkInstant,
): boolean {
  ensureTemporal();
  ensureResolvable(document, [schedule]);

  const afterNs = toEpochNs(after, 'after');
  const throughNs = toEpochNs(through, 'through');

  ensureOrdered(afterNs, throughNs, 'period', 'after');

  // Points are whole seconds: (after, through] on instants is the
  // integer range [floor(after) + 1, floor(through)].
  return finderFor(document).hasPointIn(schedule, floorSec(afterNs) + 1, floorSec(throughNs));
}

/**
 * Which occurrences lie from `from` through `through` (both boundary
 * instants included)? Timed occurrences are answered as
 * Temporal.ZonedDateTime on the document timezone's clock, all-day
 * occurrences as Temporal.PlainDate; the two kinds stay distinct, and
 * the answer is in ascending order. Unlike the period judgment, an
 * enumeration has no previous window: the caller names two instants, and
 * both are part of what it names.
 *
 * `from` must not lie after `through`: a reversed pair signals broken
 * caller state, and an empty answer would hide it, so it throws a
 * malformed-query error instead. Equal endpoints are legal and answer
 * what stands exactly at that point.
 */
export function occurrencesIn(
  document: YrnkDocument,
  schedule: YrnkSchedule,
  from: YrnkInstant,
  through: YrnkInstant,
): YrnkOccurrence[] {
  ensureTemporal();
  ensureResolvable(document, [schedule]);

  const fromNs = toEpochNs(from, 'from');
  const throughNs = toEpochNs(through, 'through');

  ensureOrdered(fromNs, throughNs, 'enumeration', 'from');

  // Timed points are compared inclusively on whole seconds (ceil the
  // start, floor the end); an all-day occurrence overlaps the range from
  // the start's own second.
  return finderFor(document).collectIn(
    schedule,
    ceilSec(fromNs),
    floorSec(fromNs),
    floorSec(throughNs),
  );
}

/**
 * Would every name these schedules write be answered by this document's
 * definitions and bindings? The same validation every query runs first,
 * reachable on its own for a caller that wants a wiring mistake surfaced
 * before a schedule is stored or a question is asked. Consults the
 * definitions and the bindings' names only and never invokes a resolver,
 * so passing says the references are answerable, not what the answers
 * will be.
 */
export function ensureResolvable(document: YrnkDocument, schedules?: Iterable<YrnkSchedule>): void {
  ensureTemporal();
  ensureReferencesResolvable(
    schedules ?? document.schedules,
    document.calendar,
    bindingsOf(document),
  );
}

/**
 * The query well-formedness rule: both endpoint-naming queries require
 * start ≤ end, compared between the instants as given — nothing is
 * rounded, and the check runs before the endpoints are cut to anything.
 */
function ensureOrdered(startNs: bigint, endNs: bigint, what: string, startName: string): void {
  if (startNs > endNs) {
    throw new YrnkError(
      'malformed-query',
      `Malformed ${what}: ${startName} must not lie after through`,
    );
  }
}

function finderFor(document: YrnkDocument) {
  return createFinder(
    document.timezone,
    createResolvedCalendar(document.calendar, document.timezone, bindingsOf(document)),
  );
}

function toEpochNs(input: YrnkInstant, what: string): bigint {
  if (input instanceof Temporal.Instant || input instanceof Temporal.ZonedDateTime) {
    return input.epochNanoseconds;
  }

  if (input instanceof Date) {
    const ms = input.getTime();

    if (!Number.isFinite(ms)) {
      throw new YrnkError('invalid-value', `${what} must be a valid Date`);
    }

    return BigInt(ms) * 1_000_000n;
  }

  if (typeof input === 'string') {
    try {
      return Temporal.Instant.from(input).epochNanoseconds;
    } catch {
      throw new YrnkError(
        'invalid-value',
        `${what} must be an ISO 8601 instant with a UTC offset: ${input}`,
      );
    }
  }

  throw new YrnkError(
    'invalid-value',
    `${what} must be a Temporal.Instant, Temporal.ZonedDateTime, Date, or ISO 8601 string`,
  );
}

const NS_PER_SEC = 1_000_000_000n;

function floorSec(ns: bigint): number {
  const quotient = ns / NS_PER_SEC;

  return Number(ns % NS_PER_SEC < 0n ? quotient - 1n : quotient);
}

function ceilSec(ns: bigint): number {
  const floor = floorSec(ns);

  return ns % NS_PER_SEC === 0n ? floor : floor + 1;
}
