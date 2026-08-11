/**
 * The library's stand on its runtime: date-time work happens through the
 * global Temporal object (ES2026), and the library ships no polyfill of
 * its own. This guard makes the absence a clear, early error instead of
 * a ReferenceError somewhere deep inside.
 */
export function ensureTemporal(): void {
  if (typeof globalThis.Temporal === 'undefined') {
    throw new Error(
      '@yarunoka/core requires the Temporal API (ES2026). Use Node.js 26+ or a browser that ships '
        + "Temporal, or install a polyfill in your application: import 'temporal-polyfill/global'",
    );
  }
}

/**
 * Why the string cannot be the document timezone, or null when it can.
 * The spec limits timezone to IANA tz database names; Temporal also
 * accepts fixed offsets as time zone identifiers, so those are told
 * apart and rejected here. Backward links (Japan, US/Eastern) are tz
 * database entries and pass.
 */
export function timezoneProblem(timezone: string): string | null {
  let id: string;

  try {
    id = new Temporal.ZonedDateTime(0n, timezone).timeZoneId;
  } catch {
    return `Unknown timezone: ${timezone}`;
  }

  if (id.startsWith('+') || id.startsWith('-')) {
    return `timezone must be an IANA Time Zone Database name (a fixed offset cannot be written): ${timezone}`;
  }

  return null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Why the string is not a Yrnk date literal, or null when it is. The
 * spelling is zero-padded YYYY-MM-DD, the date must exist in the
 * proleptic Gregorian calendar, and years run 1–9999.
 */
export function dateLiteralProblem(value: string): string | null {
  const match = DATE_PATTERN.exec(value);

  if (match === null) {
    return `Date must be in YYYY-MM-DD format: ${value}`;
  }

  if (!isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    return `Date does not exist: ${value}`;
  }

  return null;
}

/**
 * Whether the calendar has this day. Years run 1–9999 (Temporal itself
 * would accept year 0 and beyond, which the DSL does not).
 */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999) {
    return false;
  }

  try {
    Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' });

    return true;
  } catch {
    return false;
  }
}

/**
 * The wall-clock point resolved to an instant on the given zone's clock
 * per RFC 5545 §3.3.5, which is exactly Temporal's 'compatible'
 * disambiguation: a nonexistent wall time (a gap) is pushed forward by
 * the gap, and a wall time that occurs twice (the fall-back overlap)
 * counts as its first occurrence.
 */
export function resolveWall(dateTime: Temporal.PlainDateTime, timezone: string): Temporal.ZonedDateTime {
  return dateTime.toZonedDateTime(timezone, { disambiguation: 'compatible' });
}
