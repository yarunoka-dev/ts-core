import type {
  YrnkCalendar,
  YrnkDayAtom,
  YrnkDocument,
  YrnkSchedule,
  YrnkTimeSpec,
} from './model.ts';

type Raw = Record<string, unknown>;

/**
 * The mirror image of parse: the typed model back to the document's
 * array-and-object representation (`JSON.stringify` the result for the
 * wire form). Round-tripping is the identity — building a document
 * parsed from the DSL yields the original spelling, structurally.
 */
export function build(document: YrnkDocument): Record<string, unknown> {
  const raw: Raw = {};

  // Annotations lead: a labeled document tells the reader what it is
  // before how to read it.
  if (document.label !== undefined) {
    raw.label = document.label;
  }

  if (document.description !== undefined) {
    raw.description = document.description;
  }

  raw.version = document.version;
  raw.timezone = document.timezone;

  // A document that leaves nothing to its host omits the key rather than
  // writing an empty list.
  if (document.resolvers.length > 0) {
    raw.resolvers = [...document.resolvers];
  }

  const calendar = buildCalendar(document.calendar);

  if (Object.keys(calendar).length > 0) {
    raw.calendar = calendar;
  }

  raw.schedules = document.schedules.map(buildSchedule);

  return raw;
}

function buildCalendar(calendar: YrnkCalendar): Raw {
  const raw: Raw = {};

  for (const [key, definition] of [
    ['holidays', calendar.holidays],
    ['business_holidays', calendar.businessHolidays],
    ['business_days', calendar.businessDays],
  ] as const) {
    if (definition !== undefined) {
      // A name reference comes out as the name itself (output that
      // preserves the intent, on the premise that the reader holds the
      // same resolver); a written list comes out as its dates.
      raw[key] = typeof definition === 'string' ? definition : [...definition];
    }
  }

  if (calendar.workweek !== undefined) {
    raw.workweek = [...calendar.workweek];
  }

  if (calendar.businessHours !== undefined) {
    raw.business_hours = calendar.businessHours.map((window) => [...window]);
  }

  if (Object.keys(calendar.dateSets).length > 0) {
    raw.date_sets = Object.fromEntries(
      Object.entries(calendar.dateSets).map(([name, dates]) => [name, [...dates]]),
    );
  }

  return raw;
}

function buildSchedule(schedule: YrnkSchedule): Raw {
  const raw: Raw = {};

  if (schedule.label !== undefined) {
    raw.label = schedule.label;
  }

  if (schedule.description !== undefined) {
    raw.description = schedule.description;
  }

  if (schedule.from !== undefined) {
    raw.from = schedule.from;
  }

  if (schedule.until !== undefined) {
    raw.until = schedule.until;
  }

  if (schedule.years !== undefined) {
    raw.years = [...schedule.years];
  }

  if (schedule.months !== undefined) {
    raw.months = [...schedule.months];
  }

  if (schedule.days !== undefined) {
    raw.days = schedule.days.map(buildAtom);
  }

  if (schedule.shift !== undefined) {
    const condition = buildAtom(schedule.shift.condition);

    raw.shift = schedule.shift.orSame
      ? [schedule.shift.direction, 'or_same', condition]
      : [schedule.shift.direction, condition];
  }

  if (schedule.if !== undefined) {
    raw.if = [
      ...(schedule.if.direction !== null ? [schedule.if.direction] : []),
      ...(schedule.if.negated ? ['not'] : []),
      buildAtom(schedule.if.condition),
    ];
  }

  Object.assign(raw, buildTimeSpec(schedule.time));

  return raw;
}

function buildTimeSpec(time: YrnkTimeSpec): Raw {
  switch (time.kind) {
    case 'times':
      return { times: [...time.times] };
    case 'grid':
      return {
        times: {
          every: [...time.every],
          ...(time.between !== null
            ? { between: typeof time.between === 'string' ? time.between : [...time.between] }
            : {}),
        },
      };
    case 'allday':
      return { allday: true };
    case 'sequence':
      return { every: [...time.every] };
  }
}

function buildAtom(atom: YrnkDayAtom): unknown {
  switch (atom.kind) {
    case 'month-day':
      return atom.day;
    case 'weekday':
      return atom.day;
    case 'ordinal-weekday':
      return [atom.ordinal, atom.day];
    case 'last-day-of-month':
      return 'last_day_of_month';
    case 'calendar-word':
      return atom.word;
    case 'name':
      return atom.name;
    case 'day-cycle':
      return ['every', atom.interval, 'day'];
  }
}
