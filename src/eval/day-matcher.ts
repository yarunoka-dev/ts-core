import { isoNumberOf } from './days.ts';
import type { ResolvedCalendar } from './resolved-calendar.ts';
import type { YrnkDayCondition } from '../model.ts';

/**
 * The matcher for day expression atoms — the single authority on
 * membership semantics. The calendar vocabulary uses the layer model,
 * consulted top-down with early return:
 *
 *     business_days       top layer: "we work this day" — overrides everything below
 *     business_holidays   the organization's own closures
 *     holidays            public holidays; closed by default
 *     workweek            bottom layer: the weekly pattern that sets the default
 */
export function atomMatches(atom: YrnkDayCondition, day: Temporal.PlainDate, resolved: ResolvedCalendar): boolean {
  switch (atom.kind) {
    case 'month-day':
      return day.day === atom.day;
    case 'weekday':
      return day.dayOfWeek === isoNumberOf(atom.day);
    case 'ordinal-weekday':
      return matchesOrdinalWeekday(atom.ordinal, isoNumberOf(atom.day), day);
    case 'last-day-of-month':
      return day.day === day.daysInMonth;
    case 'name':
      return resolved.nameContains(atom.name, day);
    case 'calendar-word':
      switch (atom.word) {
        case 'weekday':
          return day.dayOfWeek <= 5;
        case 'weekend':
          return day.dayOfWeek >= 6;
        case 'holiday':
          return resolved.holidayContains(day);
        case 'business_day':
          return isBusinessDay(day, resolved);
        case 'business_holiday':
          return !isBusinessDay(day, resolved);
      }
  }
}

function matchesOrdinalWeekday(ordinal: string, isoDayOfWeek: number, day: Temporal.PlainDate): boolean {
  if (day.dayOfWeek !== isoDayOfWeek) {
    return false;
  }

  if (ordinal === 'last') {
    // The same weekday is 7 days later. If that does not fit in the
    // month, this one is the last.
    return day.day + 7 > day.daysInMonth;
  }

  return Math.floor((day.day - 1) / 7) + 1 === Number(ordinal[0]);
}

function isBusinessDay(day: Temporal.PlainDate, resolved: ResolvedCalendar): boolean {
  if (resolved.businessDayContains(day)) {
    return true;
  }

  if (resolved.businessHolidayContains(day)) {
    return false;
  }

  if (resolved.holidayContains(day)) {
    return false;
  }

  return resolved.isInWorkweek(day.dayOfWeek);
}
