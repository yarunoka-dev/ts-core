import { YrnkError } from './error.ts';

/**
 * The words a name must not collide with. Deliberately duplicated
 * content of the name enum in the spec's primitives.schema.json;
 * agreement is verified by a test.
 */
export const RESERVED_WORDS: readonly string[] = [
  // Calendar vocabulary (days) and the window vocabulary
  'weekday', 'weekend', 'holiday', 'business_day', 'business_holiday', 'business_hour',
  // Day names
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  // Ordinal words
  '1st', '2nd', '3rd', '4th', '5th', 'last',
  // Special days
  'last_day_of_month',
  // Structural words of shift / if
  'not', 'prev', 'next', 'or_same',
  // Unit words of every
  'hour', 'minute', 'second', 'day',
  // Structural keys of the document, schedules, and calendar
  'version', 'timezone', 'resolvers', 'calendar', 'schedules',
  'years', 'months', 'days', 'shift', 'if', 'times', 'allday', 'every', 'between', 'from', 'until',
  'holidays', 'business_holidays', 'business_days', 'workweek', 'business_hours', 'date_sets',
  // The annotation fields
  'label', 'description',
];

const reserved = new Set(RESERVED_WORDS);

/**
 * Why the string cannot be a name, or null when it can. The literal
 * shapes matter for reading, not for tidiness: a date-list position
 * tells its two forms apart by shape, so a date-shaped name would read
 * as a date list of one, and a digits-only name would read as a day of
 * month in the days axis.
 */
export function nameProblem(name: string): string | null {
  if (!/\S/u.test(name)) {
    return 'A name cannot be empty or whitespace only';
  }

  if (reserved.has(name)) {
    return `"${name}" is a reserved word and cannot be a name`;
  }

  if (/^\d+$/.test(name)) {
    return `A digits-only name is indistinguishable from a day of month: ${name}`;
  }

  if (/^\d{2}:\d{2}$/.test(name)) {
    return `A time-shaped name is not allowed: ${name}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(name)) {
    return `A date-shaped name is not allowed: ${name}`;
  }

  return null;
}

export function ensureUsableName(name: string): void {
  const problem = nameProblem(name);

  if (problem !== null) {
    throw new YrnkError('reserved-name', problem);
  }
}
