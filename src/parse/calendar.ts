import type { YrnkCalendar, YrnkDateSet, YrnkDayName } from '../model.ts';
import { ensureUsableName } from '../names.ts';
import { dateLiteralProblem } from '../temporal.ts';
import { ensureKnownKeys, invalid, isPlainObject } from './shared.ts';
import { parseWindow, timeToSeconds, windowEndToSeconds } from './times.ts';

const KNOWN_KEYS = [
  'holidays',
  'business_holidays',
  'business_days',
  'workweek',
  'business_hours',
  'date_sets',
];

const DAY_NAMES: readonly string[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/**
 * The definitions part. The top level is the closed set of reserved keys
 * (the built-in definitions); under date_sets is the open namespace. An
 * empty object is a spelling only 1.0 accepts (with the meaning of the
 * omitted key), so the declared version decides between rejecting it and
 * recording that it was authored — a serializer keeps the spelling.
 */
export function parseCalendar(raw: unknown, version: string): YrnkCalendar {
  if (raw === undefined) {
    return { dateSets: {} };
  }

  if (!isPlainObject(raw)) {
    invalid('calendar must be an object');
  }

  ensureKnownKeys(raw, KNOWN_KEYS, 'calendar');

  if (Object.keys(raw).length === 0) {
    if (version !== '1.0') {
      invalid('calendar cannot be empty (a document with no definitions omits the key)');
    }

    return { dateSets: {}, authoredEmpty: true };
  }

  const holidays = parseDateSetPosition(raw, 'holidays');
  const businessHolidays = parseDateSetPosition(raw, 'business_holidays');
  const businessDays = parseDateSetPosition(raw, 'business_days');
  const workweek = Object.hasOwn(raw, 'workweek') ? parseWorkweek(raw.workweek) : undefined;
  const businessHours = Object.hasOwn(raw, 'business_hours')
    ? parseBusinessHours(raw.business_hours)
    : undefined;

  let dateSets: Readonly<Record<string, readonly string[]>> = {};
  let dateSetsAuthoredEmpty = false;

  if (Object.hasOwn(raw, 'date_sets')) {
    const value = raw.date_sets;

    if (!isPlainObject(value)) {
      invalid('date_sets must be an object of name to date list');
    }

    if (Object.keys(value).length === 0) {
      if (version !== '1.0') {
        invalid('date_sets cannot be empty (a calendar with no named sets omits the key)');
      }

      dateSetsAuthoredEmpty = true;
    } else {
      dateSets = parseDateSets(value);
    }
  }

  return {
    ...(holidays !== undefined ? { holidays } : {}),
    ...(businessHolidays !== undefined ? { businessHolidays } : {}),
    ...(businessDays !== undefined ? { businessDays } : {}),
    ...(workweek !== undefined ? { workweek } : {}),
    ...(businessHours !== undefined ? { businessHours } : {}),
    dateSets,
    ...(dateSetsAuthoredEmpty ? { dateSetsAuthoredEmpty: true as const } : {}),
  };
}

/**
 * A date-list position: either the array of date literals, or a name.
 * The two forms are told apart by shape, which is why a date-shaped
 * string is neither (it would otherwise read as a list of one).
 */
function parseDateSetPosition(raw: Record<string, unknown>, key: string): YrnkDateSet | undefined {
  if (!Object.hasOwn(raw, key)) {
    return undefined;
  }

  const value = raw[key];

  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      invalid(`${key}: a single date is still written as a list: ["${value}"]`);
    }

    ensureUsableName(value);

    return value;
  }

  if (Array.isArray(value)) {
    return parseDateList(value, key);
  }

  invalid(`${key} must be a date list or a name`);
}

function parseDateList(raw: readonly unknown[], where: string): readonly string[] {
  const seen = new Set<string>();

  for (const date of raw) {
    if (typeof date !== 'string') {
      invalid(`${where}: dates must be YYYY-MM-DD strings`);
    }

    const problem = dateLiteralProblem(date);

    if (problem !== null) {
      invalid(`${where}: ${problem}`);
    }

    if (seen.has(date)) {
      invalid(`${where}: duplicate date in date list: ${date}`);
    }

    seen.add(date);
  }

  // Copied: the parsed document must not alias (nor later freeze) the
  // caller's own arrays.
  return [...raw] as readonly string[];
}

function parseWorkweek(raw: unknown): readonly YrnkDayName[] {
  if (!Array.isArray(raw)) {
    invalid('workweek must be a list of day names');
  }

  if (raw.length === 0) {
    invalid('workweek cannot be empty');
  }

  const seen = new Set<string>();

  for (const day of raw) {
    if (typeof day !== 'string' || !DAY_NAMES.includes(day)) {
      invalid(
        `workweek: day names must be mon through sun: ${typeof day === 'string' ? day : typeof day}`,
      );
    }

    if (seen.has(day)) {
      invalid(`Duplicate day name in workweek: ${day}`);
    }

    seen.add(day);
  }

  // Copied for the same reason as parseDateList.
  return [...raw] as readonly YrnkDayName[];
}

/**
 * The window list behind the business_hour vocabulary. Kept in written
 * order. Overlapping windows would be the quiet accident of duplicated
 * grid points, so they are rejected (the intervals are half-open, so
 * touching windows do not overlap and are legal).
 */
function parseBusinessHours(raw: unknown): readonly (readonly [string, string])[] {
  if (!Array.isArray(raw)) {
    invalid('business_hours must be a list of [HH:MM, HH:MM] pairs');
  }

  if (raw.length === 0) {
    invalid('business_hours cannot be empty');
  }

  const windows = raw.map((pair) => parseWindow(pair, 'Elements of business_hours'));
  const sorted = windows
    .map((window) => [timeToSeconds(window[0]), windowEndToSeconds(window[1])] as const)
    .sort((a, b) => a[0] - b[0]);

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const previous = sorted[i - 1];

    if (current !== undefined && previous !== undefined && current[0] < previous[1]) {
      invalid('Overlapping windows in business_hours');
    }
  }

  return windows;
}

/**
 * The open namespace, already known to be a non-empty object. A value is
 * a list of date literals and nothing else: this is where the document
 * holds the dates it names, so an entry never stands for another name.
 */
function parseDateSets(raw: Record<string, unknown>): Readonly<Record<string, readonly string[]>> {
  const entries: [string, readonly string[]][] = [];

  for (const [name, value] of Object.entries(raw)) {
    ensureUsableName(name);

    if (!Array.isArray(value)) {
      invalid(`date_sets.${name} must be a date list (a name cannot stand for another name)`);
    }

    entries.push([name, parseDateList(value, `date_sets.${name}`)]);
  }

  // Built through Object.fromEntries, which defines own properties: a
  // plain assignment would send the legal name "__proto__" through the
  // prototype setter instead of creating an entry.
  return Object.fromEntries(entries);
}
