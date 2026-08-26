import type { YrnkTimeSpec, YrnkTimeUnit } from '../model.ts';
import { ensureKnownKeys, invalid, isPlainObject, typeOf } from './shared.ts';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Seconds in each unit word of every. */
export const UNIT_SECONDS: Readonly<Record<YrnkTimeUnit, number>> = {
  hour: 3600,
  minute: 60,
  second: 1,
};

/**
 * Whether the string is a time literal: zero-padded HH:MM, 00:00
 * through 23:59. The end-of-day token "24:00" is not a time literal —
 * it is legal only as a window end.
 */
export function isTimeLiteral(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function timeToSeconds(value: string): number {
  return Number(value.slice(0, 2)) * 3600 + Number(value.slice(3, 5)) * 60;
}

/**
 * A window end as seconds from midnight — the one position where the
 * end-of-day token "24:00" (86400) may stand.
 */
export function windowEndToSeconds(end: string): number {
  return end === '24:00' ? 86400 : timeToSeconds(end);
}

/**
 * Why the values cannot be a time window [start, end), or null when
 * they can: start is zero-padded HH:MM, end is HH:MM or the end-of-day
 * token "24:00", and start is strictly before end (a window crossing
 * midnight cannot be written).
 */
export function windowProblem(start: string, end: string): string | null {
  if (!isTimeLiteral(start)) {
    return `Time of day must be in HH:MM format (00:00 through 23:59): ${start}`;
  }

  if (!isTimeLiteral(end) && end !== '24:00') {
    return `Window end must be in HH:MM format or "24:00": ${end}`;
  }

  if (timeToSeconds(start) >= windowEndToSeconds(end)) {
    return `Time window requires start < end (crossing midnight is not supported): [${start}, ${end}]`;
  }

  return null;
}

/**
 * A window pair [start, end): the shape (two strings) here, the values
 * through windowProblem.
 */
export function parseWindow(raw: unknown, where: string): readonly [string, string] {
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    typeof raw[0] !== 'string' ||
    typeof raw[1] !== 'string'
  ) {
    invalid(`${where} must be an [HH:MM, HH:MM] pair`);
  }

  const [start, end] = raw as [string, string];
  const problem = windowProblem(start, end);

  if (problem !== null) {
    invalid(problem);
  }

  return [start, end];
}

/**
 * The times value: a list = an enumeration of fixed times, an object =
 * the clock grid.
 */
export function parseTimes(raw: unknown): YrnkTimeSpec {
  if (Array.isArray(raw)) {
    return parseFixedTimes(raw);
  }

  if (isPlainObject(raw)) {
    return parseGrid(raw);
  }

  invalid('times must be a list of times or the {"every": ...} grid');
}

function parseFixedTimes(raw: readonly unknown[]): YrnkTimeSpec {
  if (raw.length === 0) {
    invalid('Times enumeration cannot be empty');
  }

  const seen = new Set<string>();

  for (const time of raw) {
    if (typeof time !== 'string' || !isTimeLiteral(time)) {
      invalid(
        `Elements of times must be zero-padded HH:MM strings: ${typeof time === 'string' ? time : typeOf(time)}`,
      );
    }

    if (seen.has(time)) {
      invalid(`Duplicate time in times: ${time}`);
    }

    seen.add(time);
  }

  // Copied: the parsed document must not alias (nor later freeze) the
  // caller's own arrays.
  return { kind: 'times', times: [...raw] as readonly string[] };
}

function parseGrid(raw: Record<string, unknown>): YrnkTimeSpec {
  ensureKnownKeys(raw, ['every', 'between'], 'times grid');

  if (!Object.hasOwn(raw, 'every')) {
    invalid('The times grid requires every');
  }

  const [amount, unit] = parseEveryTuple(raw.every);

  // One day's worth in the unit — the grid's cap.
  const cap = 86400 / UNIT_SECONDS[unit];

  if (amount > cap) {
    invalid(`Count of every must be at most ${cap} for the unit ${unit}: ${amount}`);
  }

  return {
    kind: 'grid',
    every: [amount, unit],
    between: Object.hasOwn(raw, 'between') ? parseBetween(raw.between) : null,
  };
}

function parseBetween(raw: unknown): readonly [string, string] | 'business_hour' {
  if (raw === 'business_hour') {
    return 'business_hour';
  }

  if (typeof raw === 'string') {
    invalid(`The only name allowed in between is "business_hour": ${raw}`);
  }

  return parseWindow(raw, 'between');
}

/**
 * The interval every directly on a schedule. The grid's one-day cap
 * does not apply (a from-anchored sequence keeps counting across days);
 * what bounds the count is the date domain, a per-version rule checked
 * at the schedule level. The unit "day" belongs to the date-axis day
 * cycle instead.
 */
export function parseSequenceEvery(raw: unknown): YrnkTimeSpec {
  if (Array.isArray(raw) && raw[1] === 'day') {
    invalid(
      'The interval every does not take "day" (write whole-day cycles as ["every", N, "day"] in days)',
    );
  }

  const [amount, unit] = parseEveryTuple(raw);

  return { kind: 'sequence', every: [amount, unit] };
}

function parseEveryTuple(raw: unknown): readonly [number, YrnkTimeUnit] {
  if (!Array.isArray(raw) || raw.length !== 2) {
    invalid('every must be the two elements [count, unit]');
  }

  const [amount, unit] = raw;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
    invalid('Count of every must be an integer of at least 1');
  }

  if (unit !== 'hour' && unit !== 'minute' && unit !== 'second') {
    invalid(
      `Unit of every must be "hour" | "minute" | "second" (singular): ${typeof unit === 'string' ? unit : typeOf(unit)}`,
    );
  }

  return [amount, unit];
}
