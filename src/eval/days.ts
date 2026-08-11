import type { YrnkDayName } from '../model.ts';
import { resolveWall } from '../temporal.ts';

/**
 * Calendar-day arithmetic on the document's clock. Days are
 * Temporal.PlainDate values in **denoted** form: the day an occurrence
 * chosen for that calendar date actually stands on. For every ordinary
 * day the two are the same; where a zone skips a calendar day outright
 * (the date-line crossings), the denoted day is the day that follows —
 * mirroring how the reference implementation's date values read
 * themselves off their resolved instants.
 */
export function denote(day: Temporal.PlainDate, timezone: string): Temporal.PlainDate {
  return resolveWall(day.toPlainDateTime(), timezone).toPlainDate();
}

/** The denoted day at (year, month, dayOfMonth) on the document's clock. */
export function dayAt(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Temporal.PlainDate {
  return denote(new Temporal.PlainDate(year, month, day), timezone);
}

/** The denoted day n calendar days away. */
export function addDays(
  day: Temporal.PlainDate,
  days: number,
  timezone: string,
): Temporal.PlainDate {
  return denote(day.add({ days }), timezone);
}

/** The number of calendar days from one day to another. */
export function daysBetween(from: Temporal.PlainDate, to: Temporal.PlainDate): number {
  return from.until(to, { largestUnit: 'days' }).days;
}

/** The wall date the epoch second reads as on the document's clock. */
export function wallDateOfSec(epochSeconds: number, timezone: string): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(epochSeconds * 1000)
    .toZonedDateTimeISO(timezone)
    .toPlainDate();
}

/**
 * The point secondsFromMidnight past the start of the day, resolved on
 * the document's clock like any other wall-clock point (RFC 5545
 * §3.3.5 via 'compatible' disambiguation).
 */
export function atTime(
  day: Temporal.PlainDate,
  secondsFromMidnight: number,
  timezone: string,
): Temporal.ZonedDateTime {
  return resolveWall(
    day.toPlainDateTime({
      hour: Math.floor(secondsFromMidnight / 3600),
      minute: Math.floor((secondsFromMidnight % 3600) / 60),
      second: secondsFromMidnight % 60,
    }),
    timezone,
  );
}

/** The instant of a resolved point as whole epoch seconds. */
export function epochSecOf(zoned: Temporal.ZonedDateTime): number {
  return Math.floor(zoned.epochMilliseconds / 1000);
}

/** The running month number since year zero (for scanning candidate months). */
export function monthIndex(day: Temporal.PlainDate): number {
  return day.year * 12 + (day.month - 1);
}

/** [year, month] at a running month number. */
export function yearMonthAt(index: number): readonly [number, number] {
  return [Math.floor(index / 12), (((index % 12) + 12) % 12) + 1];
}

const DAY_NAMES: readonly YrnkDayName[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** The ISO day-of-week number (Mon = 1 … Sun = 7) of a day name. */
export function isoNumberOf(name: YrnkDayName): number {
  return DAY_NAMES.indexOf(name) + 1;
}
