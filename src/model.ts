/**
 * The typed document model — the output of parse and the input of build.
 * Plain readonly data with discriminated unions: the document's source is
 * JSON, so the model stays a tree of plain objects and the language's
 * closed sets become union types. Nothing here is a class; queries and
 * builders are functions over this data.
 */

export type YrnkDayName = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type YrnkOrdinal = '1st' | '2nd' | '3rd' | '4th' | '5th' | 'last';

/**
 * The five layer-model words. weekday / weekend ask the fixed calendar
 * and consult no definition; holiday asks the holidays list alone;
 * business_day / business_holiday are questions to the stacked
 * conclusion of the layers.
 */
export type YrnkCalendarWord = 'weekday' | 'weekend' | 'holiday' | 'business_day' | 'business_holiday';

export type YrnkTimeUnit = 'hour' | 'minute' | 'second';

export type YrnkDirection = 'prev' | 'next';

/**
 * A day atom legal as a shift landing condition or an if condition —
 * every atom except the day cycle, which counts from the schedule's from
 * and is allowed only in the days enumeration.
 */
export type YrnkDayCondition =
  | { readonly kind: 'month-day'; readonly day: number }
  | { readonly kind: 'weekday'; readonly day: YrnkDayName }
  | { readonly kind: 'ordinal-weekday'; readonly ordinal: YrnkOrdinal; readonly day: YrnkDayName }
  | { readonly kind: 'last-day-of-month' }
  | { readonly kind: 'calendar-word'; readonly word: YrnkCalendarWord }
  | { readonly kind: 'name'; readonly name: string };

/** An atom of the days enumeration. */
export type YrnkDayAtom =
  | YrnkDayCondition
  | { readonly kind: 'day-cycle'; readonly interval: number };

/**
 * The shift modifier — rounding. Takes each base day selected by the
 * days condition and moves it in a fixed direction until the landing
 * condition holds. orSame is the inclusive / exclusive distinction.
 */
export type YrnkShift = {
  readonly direction: YrnkDirection;
  readonly orSame: boolean;
  readonly condition: YrnkDayCondition;
};

/**
 * The if modifier — filtering by the base day itself or a neighbour.
 * shift moves the day; if filters without moving. A null direction means
 * "the day itself".
 */
export type YrnkIf = {
  readonly direction: YrnkDirection | null;
  readonly negated: boolean;
  readonly condition: YrnkDayCondition;
};

/**
 * The time part of a schedule — exactly one of the three forms the DSL
 * offers, plus the grid's own shape. Time literals stay as written
 * (zero-padded HH:MM), so round-tripping is the identity.
 */
export type YrnkTimeSpec =
  /** An enumeration of fixed times, in written order */
  | { readonly kind: 'times'; readonly times: readonly string[] }
  /** A clock grid; null between means the whole day [00:00, 24:00) */
  | {
      readonly kind: 'grid';
      readonly every: readonly [number, YrnkTimeUnit];
      readonly between: readonly [string, string] | 'business_hour' | null;
    }
  /** A day-level occurrence that carries no time */
  | { readonly kind: 'allday' }
  /** The from-anchored interval sequence, counting across days */
  | { readonly kind: 'sequence'; readonly every: readonly [number, YrnkTimeUnit] };

/**
 * One element of the DSL's schedules[]. The date axes (years / months /
 * days) combine with AND; an absent axis means no restriction. from /
 * until is the validity range — a boundary clipping the schedule's set
 * of points to [from, until), spelled "YYYY-MM-DD HH:MM" on the document
 * timezone's clock.
 */
export type YrnkSchedule = {
  readonly label?: string;
  readonly description?: string;
  readonly from?: string;
  readonly until?: string;
  readonly years?: readonly number[];
  readonly months?: readonly number[];
  readonly days?: readonly YrnkDayAtom[];
  readonly shift?: YrnkShift;
  readonly if?: YrnkIf;
  readonly time: YrnkTimeSpec;
};

/**
 * A date-list position of the calendar: the list of date literals the
 * document contains, or the name of what resolves it. The two forms are
 * told apart by type, exactly as the DSL tells them apart by shape.
 */
export type YrnkDateSet = readonly string[] | string;

/**
 * The definitions part. The built-in definitions carry the layer-model
 * semantics; dateSets is the open namespace. undefined means "not
 * defined" — distinct from an explicit empty list (the statement that
 * there are no such days). Only an undefined workweek means the default
 * (Mon–Fri) instead.
 */
export type YrnkCalendar = {
  readonly holidays?: YrnkDateSet;
  readonly businessHolidays?: YrnkDateSet;
  readonly businessDays?: YrnkDateSet;
  readonly workweek?: readonly YrnkDayName[];
  readonly businessHours?: readonly (readonly [string, string])[];
  readonly dateSets: Readonly<Record<string, readonly string[]>>;
};

declare const parsedDocument: unique symbol;

/**
 * A parsed Yrnk document. The brand marks that the value went through
 * parse — validated, normalized, and with its resolver bindings
 * registered — telling it apart from raw JSON of the same shape at the
 * type level.
 */
export type YrnkDocument = {
  readonly version: string;
  readonly timezone: string;
  /** The names this document leaves to its host; empty when none */
  readonly resolvers: readonly string[];
  readonly calendar: YrnkCalendar;
  readonly schedules: readonly YrnkSchedule[];
  readonly label?: string;
  readonly description?: string;
  readonly [parsedDocument]: true;
};

/**
 * What the host binds a declared name to. Asked with the date range the
 * answer has to cover; dates outside it are ignored, and dates missing
 * inside it read as "not in this set". The contract is synchronous on
 * purpose: an async source is pre-fetched by the caller and wrapped as a
 * resolver returning a static list.
 */
export type YrnkResolver = (range: {
  readonly from: Temporal.PlainDate;
  readonly through: Temporal.PlainDate;
}) => readonly string[];

/**
 * An occurrence as a query answers it: a whole day (all-day) or an
 * instant on the document timezone's clock (timed). The two kinds never
 * merge — a day and a timed point at its 00:00 are distinct occurrences,
 * and the types carry that distinction.
 */
export type YrnkOccurrence = Temporal.PlainDate | Temporal.ZonedDateTime;
