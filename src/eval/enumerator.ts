import type { YrnkDayCondition } from '../model.ts';
import { atomMatches } from './day-matcher.ts';
import { dayAt, isoNumberOf } from './days.ts';
import type { ResolvedCalendar } from './resolved-calendar.ts';

/**
 * Atom × (year, month) → the enumeration of matching days of that month
 * (day numbers, ascending). Atoms determined by the structure of the
 * calendar are computed directly by arithmetic; atoms backed by
 * definition data (names, calendar vocabulary) are picked by running the
 * days of the month through the matcher — the matcher stays the single
 * authority on membership semantics, and this is its enumerating form.
 */
export function atomDaysIn(
  atom: YrnkDayCondition,
  year: number,
  month: number,
  timezone: string,
  resolved: ResolvedCalendar,
): readonly number[] {
  switch (atom.kind) {
    case 'month-day':
      return atom.day <= daysInMonth(year, month, timezone) ? [atom.day] : [];
    case 'weekday':
      return weekdayDays(isoNumberOf(atom.day), year, month, timezone);
    case 'ordinal-weekday': {
      const days = weekdayDays(isoNumberOf(atom.day), year, month, timezone);

      if (atom.ordinal === 'last') {
        return days.slice(-1);
      }

      const day = days[Number(atom.ordinal[0]) - 1];

      return day !== undefined ? [day] : [];
    }
    case 'last-day-of-month':
      return [daysInMonth(year, month, timezone)];
    default:
      return scanDays(atom, year, month, timezone, resolved);
  }
}

function weekdayDays(
  isoDayOfWeek: number,
  year: number,
  month: number,
  timezone: string,
): number[] {
  const first = dayAt(year, month, 1, timezone);
  const offset = (isoDayOfWeek - first.dayOfWeek + 7) % 7;
  const days: number[] = [];

  for (let day = 1 + offset; day <= first.daysInMonth; day += 7) {
    days.push(day);
  }

  return days;
}

function scanDays(
  atom: YrnkDayCondition,
  year: number,
  month: number,
  timezone: string,
  resolved: ResolvedCalendar,
): number[] {
  const days: number[] = [];
  const limit = daysInMonth(year, month, timezone);

  for (let day = 1; day <= limit; day++) {
    if (atomMatches(atom, dayAt(year, month, day, timezone), resolved)) {
      days.push(day);
    }
  }

  return days;
}

function daysInMonth(year: number, month: number, timezone: string): number {
  return dayAt(year, month, 1, timezone).daysInMonth;
}
