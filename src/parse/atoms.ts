import { ensureUsableName } from '../names.ts';
import type {
  YrnkCalendarWord,
  YrnkDayAtom,
  YrnkDayCondition,
  YrnkDayName,
  YrnkDirection,
  YrnkIf,
  YrnkOrdinal,
  YrnkShift,
} from '../model.ts';
import { invalid, typeOf } from './shared.ts';

const DAY_NAMES: readonly string[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const ORDINALS: readonly string[] = ['1st', '2nd', '3rd', '4th', '5th', 'last'];
const CALENDAR_WORDS: readonly string[] = ['weekday', 'weekend', 'holiday', 'business_day', 'business_holiday'];
/** Structural words of shift / if. Their appearance in an atom position gets a dedicated error. */
const MODIFIER_WORDS: readonly string[] = ['not', 'prev', 'next', 'or_same'];

/**
 * The day expression of days: a non-empty enumeration of atoms with no
 * structural duplicates. The day-cycle tuple is writable only here, so
 * its routing happens at this level rather than in the general atom
 * parser.
 */
export function parseDayExpression(raw: unknown): readonly YrnkDayAtom[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    invalid('days must be a non-empty list of atoms (a scalar cannot be written)');
  }

  const atoms = raw.map((atom): YrnkDayAtom =>
    Array.isArray(atom) && atom[0] === 'every' ? parseDayCycle(atom) : parseDayCondition(atom),
  );

  // Compare the whole structure of the atom, as JSON Schema's
  // uniqueItems does. The parsed nodes are built with a fixed member
  // order, so their JSON is a canonical key.
  const seen = new Set<string>();

  for (const atom of atoms) {
    const key = JSON.stringify(atom);

    if (seen.has(key)) {
      invalid('Duplicate day atom in days');
    }

    seen.add(key);
  }

  return atoms;
}

/**
 * A day atom outside the days enumeration (a shift landing condition or
 * an if condition) — every atom form except the day cycle.
 */
export function parseDayCondition(raw: unknown): YrnkDayCondition {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1 || raw > 31) {
      invalid(`Day of month must be an integer between 1 and 31: ${raw}`);
    }

    return { kind: 'month-day', day: raw };
  }

  if (typeof raw === 'string') {
    return parseWord(raw);
  }

  if (Array.isArray(raw)) {
    return parseOrdinalTuple(raw);
  }

  invalid(`Cannot interpret as a day expression atom (${typeOf(raw)})`);
}

function parseWord(word: string): YrnkDayCondition {
  if (word === '') {
    invalid('Day expression atom cannot be an empty string');
  }

  if (DAY_NAMES.includes(word)) {
    return { kind: 'weekday', day: word as YrnkDayName };
  }

  if (CALENDAR_WORDS.includes(word)) {
    return { kind: 'calendar-word', word: word as YrnkCalendarWord };
  }

  if (word === 'last_day_of_month') {
    return { kind: 'last-day-of-month' };
  }

  if (ORDINALS.includes(word)) {
    invalid(`An ordinal word is usable only inside a tuple: write "${word}" as [["${word}", "mon"]]`);
  }

  if (MODIFIER_WORDS.includes(word)) {
    invalid(`"${word}" is not usable as a day expression atom (it is a structural word of shift / if)`);
  }

  if (word === 'business_hour') {
    invalid('business_hour is window vocabulary (use it in between)');
  }

  if (/^(\d+|\d{4}-\d{2}-\d{2}|\d{2}:\d{2})$/.test(word)) {
    invalid(`A literal shape cannot be written directly in days: ${word} (give the dates a name under date_sets and refer to it)`);
  }

  // Whatever is left is a name, and it is held to what every name is
  // held to — the vocabulary above has already taken the words that read
  // as something else.
  ensureUsableName(word);

  return { kind: 'name', name: word };
}

function parseOrdinalTuple(raw: readonly unknown[]): YrnkDayCondition {
  if (raw[0] === 'every') {
    invalid('["every", N, "day"] is allowed only in the days enumeration (not in shift / if)');
  }

  if (raw.length !== 2 || typeof raw[0] !== 'string' || typeof raw[1] !== 'string') {
    invalid('An ordinal tuple must be the two elements [ordinal word, day name]');
  }

  if (!ORDINALS.includes(raw[0])) {
    invalid(`Ordinal word must be one of 1st through 5th or last: ${raw[0]}`);
  }

  if (!DAY_NAMES.includes(raw[1])) {
    invalid(`Day name must be mon through sun: ${raw[1]}`);
  }

  return { kind: 'ordinal-weekday', ordinal: raw[0] as YrnkOrdinal, day: raw[1] as YrnkDayName };
}

/**
 * The day-cycle tuple (["every", N, "day"] — every N days). Only arrays
 * whose first element is "every" arrive here.
 */
function parseDayCycle(raw: readonly unknown[]): YrnkDayAtom {
  if (raw.length !== 3) {
    invalid('A day-cycle tuple must be the three elements ["every", count, "day"]');
  }

  const [, amount, unit] = raw;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
    invalid(`Count of every must be an integer of at least 1: ${typeOf(amount) === 'number' ? amount : typeOf(amount)}`);
  }

  if (unit !== 'day') {
    invalid(`The unit of the date-axis every is "day" (singular) only: ${typeof unit === 'string' ? unit : typeOf(unit)}`);
  }

  return { kind: 'day-cycle', interval: amount as number };
}

export function parseShift(raw: unknown): YrnkShift {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) {
    invalid('shift must be [direction, landing condition] or [direction, "or_same", landing condition]');
  }

  if (raw[0] !== 'prev' && raw[0] !== 'next') {
    invalid('Direction of shift must be "prev" or "next"');
  }

  if (raw.length === 3 && raw[1] !== 'or_same') {
    invalid('The three-element form of shift requires "or_same" as its second element');
  }

  return {
    direction: raw[0] as YrnkDirection,
    orSame: raw.length === 3,
    condition: parseDayCondition(raw[raw.length - 1]),
  };
}

export function parseIf(raw: unknown): YrnkIf {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) {
    invalid('if must be an array of one to three elements: [direction?, "not"?, condition]');
  }

  const direction: YrnkDirection | null = raw[0] === 'prev' || raw[0] === 'next' ? raw[0] : null;
  const rest = direction === null ? raw : raw.slice(1);

  if (rest.length === 2) {
    if (rest[0] !== 'not') {
      invalid('Only "not" can precede the condition of if');
    }

    return { direction, negated: true, condition: parseDayCondition(rest[1]) };
  }

  if (rest.length !== 1) {
    invalid('if must be [direction?, "not"?, condition]');
  }

  return { direction, negated: false, condition: parseDayCondition(rest[0]) };
}
