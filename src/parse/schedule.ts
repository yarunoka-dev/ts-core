import { descriptionProblem, labelProblem } from '../annotations.ts';
import type { YrnkDayAtom, YrnkSchedule, YrnkTimeSpec, YrnkTimeUnit } from '../model.ts';
import { isRealDate, resolveWall } from '../temporal.ts';
import { parseDayExpression, parseIf, parseShift } from './atoms.ts';
import { ensureKnownKeys, invalid, isPlainObject, typeOf } from './shared.ts';
import { parseSequenceEvery, parseTimes } from './times.ts';

const KNOWN_KEYS = [
  'from',
  'until',
  'years',
  'months',
  'days',
  'shift',
  'if',
  'times',
  'allday',
  'every',
  'label',
  'description',
];

/** The from / until literal: zero-padded, a single space, no seconds. */
const BOUNDARY_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):[0-5]\d$/;

/**
 * For each unit of every, the largest count whose second matching day
 * or point stays inside the date domain when from sits at its lower
 * end. Every count beyond a bound collapses to the same behavior — the
 * anchor alone — so 1.1 rejects it, freeing implementations from
 * huge-number arithmetic.
 */
const DAY_CYCLE_MAX_COUNT = 3_652_058;

const SEQUENCE_MAX_COUNT: Readonly<Record<YrnkTimeUnit, number>> = {
  hour: 87_649_415,
  minute: 5_258_964_959,
  second: 315_537_897_599,
};

/**
 * One element of the DSL's schedules[], parsed and validated as such.
 * That names are not checked for resolvability here is a property of the
 * data, not a limitation: a schedule carries no definitions, so
 * resolving names is the document parser's and the evaluator's job.
 */
export function parseSchedule(raw: unknown, timezone: string, version: string): YrnkSchedule {
  if (!isPlainObject(raw)) {
    invalid('A schedule must be an object');
  }

  ensureKnownKeys(raw, KNOWN_KEYS, 'schedule');

  const time = parseTimeSpec(raw);
  const years = parseIntAxis(raw, 'years', 1, 9999);
  const months = parseIntAxis(raw, 'months', 1, 12);
  const days = Object.hasOwn(raw, 'days') ? parseDayExpression(raw.days) : undefined;
  const shift = Object.hasOwn(raw, 'shift') ? parseShift(raw.shift) : undefined;
  const ifGuard = Object.hasOwn(raw, 'if') ? parseIf(raw.if) : undefined;
  const from = parseBoundary(raw, 'from');
  const until = parseBoundary(raw, 'until');
  const label = parseAnnotation(raw, 'label', labelProblem);
  const description = parseAnnotation(raw, 'description', descriptionProblem);

  // The resolved instant of from must be strictly earlier than the
  // resolved instant of until — the comparison is between instants,
  // never wall-clock values.
  if (from !== undefined && until !== undefined) {
    const lower = resolveWall(Temporal.PlainDateTime.from(from.replace(' ', 'T')), timezone);
    const upper = resolveWall(Temporal.PlainDateTime.from(until.replace(' ', 'T')), timezone);

    if (Temporal.ZonedDateTime.compare(lower, upper) >= 0) {
      invalid('from must be earlier than until');
    }
  }

  // Vocabulary that counts requires from — there is no way to start
  // counting without it.
  if (from === undefined) {
    if (time.kind === 'sequence') {
      invalid('The interval every requires from (there is no way to start counting without it)');
    }

    if (days?.some((atom) => atom.kind === 'day-cycle')) {
      invalid(
        'A schedule that uses ["every", N, "day"] requires from (there is no way to start counting without it)',
      );
    }
  }

  // The count bounds are restrictions 1.1 introduced, binding only
  // documents that declare the version that introduced them, or a newer
  // one — never a document declaring 1.0.
  if (version !== '1.0') {
    ensureCountsWithinBounds(days, time);
  }

  // The interval every is a sequence of points, not a product of
  // matching days × times, so it does not combine with the date axes and
  // modifiers.
  if (
    time.kind === 'sequence' &&
    (years !== undefined ||
      months !== undefined ||
      days !== undefined ||
      shift !== undefined ||
      ifGuard !== undefined)
  ) {
    invalid('The interval every cannot be combined with years / months / days / shift / if');
  }

  return {
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(years !== undefined ? { years } : {}),
    ...(months !== undefined ? { months } : {}),
    ...(days !== undefined ? { days } : {}),
    ...(shift !== undefined ? { shift } : {}),
    ...(ifGuard !== undefined ? { if: ifGuard } : {}),
    time,
  };
}

function ensureCountsWithinBounds(
  days: readonly YrnkDayAtom[] | undefined,
  time: YrnkTimeSpec,
): void {
  for (const atom of days ?? []) {
    if (atom.kind === 'day-cycle' && atom.interval > DAY_CYCLE_MAX_COUNT) {
      invalid(
        `Count of every must be at most ${DAY_CYCLE_MAX_COUNT} for the unit day: ${atom.interval}`,
      );
    }
  }

  if (time.kind === 'sequence' && time.every[0] > SEQUENCE_MAX_COUNT[time.every[1]]) {
    invalid(
      `Count of every must be at most ${SEQUENCE_MAX_COUNT[time.every[1]]} for the unit ${time.every[1]}: ${time.every[0]}`,
    );
  }
}

function parseTimeSpec(raw: Record<string, unknown>): YrnkTimeSpec {
  const present = (['times', 'allday', 'every'] as const).filter((key) => Object.hasOwn(raw, key));

  if (present.length > 1) {
    invalid(`times / allday / every are mutually exclusive: ${present.join(', ')}`);
  }

  const key = present[0];

  if (key === undefined) {
    invalid('Exactly one of times, allday, or every is required');
  }

  if (key === 'times') {
    return parseTimes(raw.times);
  }

  if (key === 'every') {
    return parseSequenceEvery(raw.every);
  }

  if (raw.allday !== true) {
    invalid('allday accepts only true (omit it otherwise)');
  }

  return { kind: 'allday' };
}

function parseBoundary(raw: Record<string, unknown>, key: 'from' | 'until'): string | undefined {
  if (!Object.hasOwn(raw, key)) {
    return undefined;
  }

  const value = raw[key];

  if (typeof value !== 'string') {
    invalid(`${key} must be a "YYYY-MM-DD HH:MM" string: ${typeOf(value)}`);
  }

  const match = BOUNDARY_PATTERN.exec(value);

  if (match === null) {
    invalid(`${key} must be a "YYYY-MM-DD HH:MM" string: ${value}`);
  }

  if (!isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    invalid(`Date does not exist: ${value}`);
  }

  return value;
}

function parseIntAxis(
  raw: Record<string, unknown>,
  axis: 'years' | 'months',
  min: number,
  max: number,
): readonly number[] | undefined {
  if (!Object.hasOwn(raw, axis)) {
    return undefined;
  }

  const values = raw[axis];

  if (!Array.isArray(values)) {
    invalid(`${axis} must be a list of integers (a scalar cannot be written)`);
  }

  if (values.length === 0) {
    invalid(`Enumeration of ${axis} cannot be empty (omit it for no restriction)`);
  }

  const seen = new Set<number>();

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      invalid(
        `Elements of ${axis} must be integers: ${typeof value === 'number' ? value : typeOf(value)}`,
      );
    }

    if (value < min || value > max) {
      invalid(`Value of ${axis} must be between ${min} and ${max}: ${value}`);
    }

    if (seen.has(value)) {
      invalid(`Duplicate value in ${axis}: ${value}`);
    }

    seen.add(value);
  }

  // Copied: the parsed document must not alias (nor later freeze) the
  // caller's own arrays.
  return [...values] as readonly number[];
}

function parseAnnotation(
  raw: Record<string, unknown>,
  key: 'label' | 'description',
  problemWith: (value: string) => string | null,
): string | undefined {
  if (!Object.hasOwn(raw, key)) {
    return undefined;
  }

  const value = raw[key];

  if (typeof value !== 'string') {
    invalid(`${key} must be a string: ${typeOf(value)}`);
  }

  const problem = problemWith(value);

  if (problem !== null) {
    invalid(problem);
  }

  return value;
}
