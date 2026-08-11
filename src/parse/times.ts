import type { YrnkTimeSpec, YrnkTimeUnit } from '../model.ts';
import { ensureKnownKeys, invalid, isPlainObject, typeOf } from './shared.ts';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One day's worth in each unit — the grid's cap. */
const GRID_MAX: Readonly<Record<YrnkTimeUnit, number>> = { hour: 24, minute: 1440, second: 86400 };

export function isTimeLiteral(value: string): boolean {
  return TIME_PATTERN.test(value);
}

export function timeToSeconds(value: string): number {
  return Number(value.slice(0, 2)) * 3600 + Number(value.slice(3, 5)) * 60;
}

/**
 * A window pair [start, end): zero-padded HH:MM with "24:00" allowed
 * only as the end, and start strictly before end (windows crossing
 * midnight cannot be written).
 */
export function parseWindow(raw: unknown, where: string): readonly [string, string] {
  if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== 'string' || typeof raw[1] !== 'string') {
    invalid(`${where} must be an [HH:MM, HH:MM] pair`);
  }

  const [start, end] = raw as [string, string];

  if (!isTimeLiteral(start)) {
    invalid(`Time of day must be in HH:MM format (00:00 through 23:59): ${start}`);
  }

  if (!isTimeLiteral(end) && end !== '24:00') {
    invalid(`Window end must be in HH:MM format or "24:00": ${end}`);
  }

  const startSeconds = timeToSeconds(start);
  const endSeconds = end === '24:00' ? 86400 : timeToSeconds(end);

  if (startSeconds >= endSeconds) {
    invalid(`Time window requires start < end (crossing midnight is not supported): [${start}, ${end}]`);
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
      invalid(`Elements of times must be zero-padded HH:MM strings: ${typeof time === 'string' ? time : typeOf(time)}`);
    }

    if (seen.has(time)) {
      invalid(`Duplicate time in times: ${time}`);
    }

    seen.add(time);
  }

  return { kind: 'times', times: raw as readonly string[] };
}

function parseGrid(raw: Record<string, unknown>): YrnkTimeSpec {
  ensureKnownKeys(raw, ['every', 'between'], 'times grid');

  if (!Object.hasOwn(raw, 'every')) {
    invalid('The times grid requires every');
  }

  const [amount, unit] = parseEveryTuple(raw['every']);

  if (amount > GRID_MAX[unit]) {
    invalid(`Count of every must be at most ${GRID_MAX[unit]} for the unit ${unit}: ${amount}`);
  }

  return {
    kind: 'grid',
    every: [amount, unit],
    between: Object.hasOwn(raw, 'between') ? parseBetween(raw['between']) : null,
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
 * The interval every directly on a schedule. Unlike the times grid the
 * count has no upper bound (a from-anchored sequence keeps counting
 * across days, so a one-day cap would be meaningless); the unit "day"
 * belongs to the date-axis day cycle instead.
 */
export function parseSequenceEvery(raw: unknown): YrnkTimeSpec {
  if (Array.isArray(raw) && raw[1] === 'day') {
    invalid('The interval every does not take "day" (write whole-day cycles as ["every", N, "day"] in days)');
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
    invalid(`Unit of every must be "hour" | "minute" | "second" (singular): ${typeof unit === 'string' ? unit : typeOf(unit)}`);
  }

  return [amount, unit];
}
