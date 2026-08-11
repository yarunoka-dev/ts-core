import type { YrnkSchedule, YrnkShift, YrnkTimeUnit } from '../model.ts';
import { resolveWall } from '../temporal.ts';
import { atomMatches } from './day-matcher.ts';
import {
  addDays,
  atTime,
  dayAt,
  daysBetween,
  epochSecOf,
  monthIndex,
  wallDateOfSec,
  yearMonthAt,
} from './days.ts';
import { atomDaysIn } from './enumerator.ts';
import type { ResolvedCalendar } from './resolved-calendar.ts';
import { secondsOf } from './times-expander.ts';

/**
 * Enumeration of candidate months and composition of if / shift / times
 * (the substance of matches / hasMatchIn / occurrencesIn).
 *
 * The questions that name a range are evaluated by the year → month →
 * day hierarchy, not by walking days: years / months narrow the (year,
 * month) pairs overlapping the range, the days atoms enumerate the
 * matching days per month, if filters them, shift maps them to landing
 * days, and the times points are laid on top and checked against the
 * range. The answer becomes no when the candidates run out, so there is
 * no search horizon.
 *
 * Instants are handled as whole epoch seconds (no scheduled point is
 * finer); days as denoted Temporal.PlainDate values. from / until (the
 * validity range) folds into the range the question names. The interval
 * every is evaluated on a dedicated arithmetic path that skips the day
 * hierarchy; the day cycle counts from the schedule's from, so it is
 * matched here rather than in the context-free matcher.
 */

/**
 * Definition data in which no day satisfying the shift landing condition
 * appears within this many consecutive days is considered a contract
 * violation: the search is cut off and the answer is "no landing".
 */
const SHIFT_SEARCH_LIMIT_DAYS = 366;

/**
 * Margin around the range a question names covering how far a wall
 * reading can sit from its instant: two days, comfortably above the
 * widest offset a zone can apply (UTC−12 to UTC+14).
 */
const WALL_OFFSET_SLACK_SECONDS = 172800;

const UNIT_SECONDS: Readonly<Record<YrnkTimeUnit, number>> = { hour: 3600, minute: 60, second: 1 };

type Finder = {
  /** matches, with the given instant truncated to whole seconds. */
  matchesAt(schedule: YrnkSchedule, atSec: number): boolean;
  /** Is there a point p with lo ≤ p ≤ hi (whole epoch seconds)? */
  hasPointIn(schedule: YrnkSchedule, lo: number, hi: number): boolean;
  /**
   * The occurrences from loTimed (timed) / loAllday (all-day overlap)
   * through hi. The two lower bounds differ only when the caller's from
   * carries a fraction of a second.
   */
  collectIn(
    schedule: YrnkSchedule,
    loTimed: number,
    loAllday: number,
    hi: number,
  ): (Temporal.PlainDate | Temporal.ZonedDateTime)[];
};

export function createFinder(timezone: string, resolved: ResolvedCalendar): Finder {
  /** The validity range as whole seconds: points live in [fromSec, untilSec − 1]. */
  function boundsOf(schedule: YrnkSchedule): { fromSec: number; untilSec: number } {
    return {
      fromSec: schedule.from !== undefined ? epochSecOf(resolveBoundary(schedule.from)) : -Infinity,
      untilSec:
        schedule.until !== undefined ? epochSecOf(resolveBoundary(schedule.until)) : Infinity,
    };
  }

  function resolveBoundary(literal: string): Temporal.ZonedDateTime {
    return resolveWall(Temporal.PlainDateTime.from(literal.replace(' ', 'T')), timezone);
  }

  /** The resolved from, for the vocabulary that counts from it. */
  function anchorOf(schedule: YrnkSchedule): Temporal.ZonedDateTime | null {
    return schedule.from !== undefined ? resolveBoundary(schedule.from) : null;
  }

  function matchesAt(schedule: YrnkSchedule, atSec: number): boolean {
    if (schedule.time.kind === 'sequence') {
      // Points are whole seconds, so "is there a point in (at−1, at]" =
      // "is at a point".
      return hasPointIn(schedule, atSec, atSec);
    }

    const day = wallDateOfSec(atSec, timezone);

    if (!dayMatches(schedule, day) && !vanishedDayLandsOn(schedule, day)) {
      return false;
    }

    const { fromSec, untilSec } = boundsOf(schedule);

    if (schedule.time.kind === 'allday') {
      // The day stays as long as the validity range holds part of it.
      return dayOverlaps(day, fromSec, untilSec - 1);
    }

    // Compare against the day's points resolved to instants, not against
    // wall-clock seconds: on a DST transition day the wall clock and the
    // points diverge (RFC 5545 §3.3.5).
    for (const second of secondsOf(schedule.time, resolved)) {
      const instant = epochSecOf(atTime(day, second, timezone));

      if (instant === atSec) {
        return instant >= fromSec && instant < untilSec;
      }
    }

    return false;
  }

  function hasPointIn(schedule: YrnkSchedule, lo: number, hi: number): boolean {
    // Fold the validity range [from, until) into the period.
    const { fromSec, untilSec } = boundsOf(schedule);
    const lower = Math.max(lo, fromSec);
    const upper = Math.min(hi, untilSec - 1);

    if (lower > upper) {
      return false;
    }

    if (schedule.time.kind === 'sequence') {
      return sequencePointRunsIn(schedule, schedule.time.every, lower, upper).length > 0;
    }

    const afterDay = wallDateOfSec(lower - 1, timezone);
    const throughDay = wallDateOfSec(upper, timezone);

    if (schedule.time.kind === 'allday') {
      return landedDaysWithin(schedule, afterDay, throughDay).some((day) =>
        dayOverlaps(day, lower, upper),
      );
    }

    const seconds = secondsOf(schedule.time, resolved);

    if (seconds.length === 0) {
      return false;
    }

    // Only landing days inside [afterDay, throughDay] can reach the
    // period, so look at the base days of the overlapping months first.
    for (let index = monthIndex(afterDay); index <= monthIndex(throughDay); index++) {
      const [year, month] = yearMonthAt(index);

      if (
        hasInstantIn(
          landedDaysIn(schedule, year, month),
          seconds,
          lower,
          upper,
          afterDay,
          throughDay,
        )
      ) {
        return true;
      }
    }

    if (schedule.shift === undefined) {
      return false;
    }

    // Base days in months outside the period can be shifted into it;
    // walk the months on the side opposite to the shift direction to
    // pick those up.
    return schedule.shift.direction === 'next'
      ? hasSpilledMatchBefore(schedule, seconds, lower, upper, afterDay, throughDay)
      : hasSpilledMatchAfter(schedule, seconds, lower, upper, afterDay, throughDay);
  }

  function collectIn(
    schedule: YrnkSchedule,
    loTimed: number,
    loAllday: number,
    hi: number,
  ): (Temporal.PlainDate | Temporal.ZonedDateTime)[] {
    const { fromSec, untilSec } = boundsOf(schedule);
    const lowerTimed = Math.max(loTimed, fromSec);
    const lowerAllday = Math.max(loAllday, fromSec);
    const upper = Math.min(hi, untilSec - 1);

    if (schedule.time.kind === 'sequence') {
      return sequenceOccurrencesIn(schedule, schedule.time.every, lowerTimed, upper);
    }

    if (lowerAllday > upper) {
      return [];
    }

    const fromDay = wallDateOfSec(lowerAllday, timezone);
    const throughDay = wallDateOfSec(upper, timezone);
    const days = landedDaysWithin(schedule, fromDay, throughDay);

    if (schedule.time.kind === 'allday') {
      return days.filter((day) => dayOverlaps(day, lowerAllday, upper));
    }

    // Points are keyed by instant: distinct wall times folded onto one
    // instant by a DST gap collapse, and the final sort orders by
    // instant even where the fold locally reverses the wall-clock order.
    const seconds = secondsOf(schedule.time, resolved);
    const instants = new Map<number, Temporal.ZonedDateTime>();

    for (const day of days) {
      for (const second of seconds) {
        const zoned = atTime(day, second, timezone);
        const instant = epochSecOf(zoned);

        if (instant >= lowerTimed && instant <= upper) {
          instants.set(instant, zoned);
        }
      }
    }

    return [...instants.entries()].sort((a, b) => a[0] - b[0]).map(([, zoned]) => zoned);
  }

  /**
   * The landing days from fromDay through throughDay, ascending and
   * without duplicates. Months overlapping the window carry the base
   * days whose landings can lie inside it; with a shift, base days of
   * months on the opposite side of the shift direction can spill in.
   */
  function landedDaysWithin(
    schedule: YrnkSchedule,
    fromDay: Temporal.PlainDate,
    throughDay: Temporal.PlainDate,
  ): Temporal.PlainDate[] {
    const found = new Map<string, Temporal.PlainDate>();

    const collect = (days: readonly Temporal.PlainDate[]): void => {
      for (const day of days) {
        if (
          Temporal.PlainDate.compare(fromDay, day) <= 0 &&
          Temporal.PlainDate.compare(day, throughDay) <= 0
        ) {
          found.set(day.toString(), day);
        }
      }
    };

    for (let index = monthIndex(fromDay); index <= monthIndex(throughDay); index++) {
      const [year, month] = yearMonthAt(index);

      collect(landedDaysIn(schedule, year, month));
    }

    if (schedule.shift?.direction === 'next') {
      for (let index = monthIndex(fromDay) - 1; ; index--) {
        const [year, month] = yearMonthAt(index);
        const monthLast = lastDayOf(year, month);

        if (
          Temporal.PlainDate.compare(
            fromDay,
            addDays(monthLast, SHIFT_SEARCH_LIMIT_DAYS, timezone),
          ) > 0
        ) {
          break;
        }

        const landed = landedDaysIn(schedule, year, month);

        collect(landed);

        const last = landed[landed.length - 1];

        if (last !== undefined && Temporal.PlainDate.compare(fromDay, last) > 0) {
          break;
        }
      }
    }

    if (schedule.shift?.direction === 'prev') {
      for (let index = monthIndex(throughDay) + 1; ; index++) {
        const [year, month] = yearMonthAt(index);

        if (
          Temporal.PlainDate.compare(
            addDays(dayAt(year, month, 1, timezone), -SHIFT_SEARCH_LIMIT_DAYS, timezone),
            throughDay,
          ) > 0
        ) {
          break;
        }

        const landed = landedDaysIn(schedule, year, month);

        collect(landed);

        const first = landed[0];

        if (first !== undefined && Temporal.PlainDate.compare(first, throughDay) > 0) {
          break;
        }
      }
    }

    return [...found.values()].sort(Temporal.PlainDate.compare);
  }

  /**
   * Base days of earlier months spilling into the period by a forward
   * (next) shift. A landing is at most 366 days from its base day, so
   * months further back are cut off; landing days are monotonic in their
   * base days, so the search is exhausted once the month's last landing
   * falls before the start of the period.
   */
  function hasSpilledMatchBefore(
    schedule: YrnkSchedule,
    seconds: readonly number[],
    lo: number,
    hi: number,
    afterDay: Temporal.PlainDate,
    throughDay: Temporal.PlainDate,
  ): boolean {
    for (let index = monthIndex(afterDay) - 1; ; index--) {
      const [year, month] = yearMonthAt(index);
      const monthLast = lastDayOf(year, month);

      if (
        Temporal.PlainDate.compare(
          afterDay,
          addDays(monthLast, SHIFT_SEARCH_LIMIT_DAYS, timezone),
        ) > 0
      ) {
        return false;
      }

      const landed = landedDaysIn(schedule, year, month);

      if (hasInstantIn(landed, seconds, lo, hi, afterDay, throughDay)) {
        return true;
      }

      const last = landed[landed.length - 1];

      if (last !== undefined && Temporal.PlainDate.compare(afterDay, last) > 0) {
        return false;
      }
    }
  }

  /** The mirror image of hasSpilledMatchBefore, for a backward (prev) shift. */
  function hasSpilledMatchAfter(
    schedule: YrnkSchedule,
    seconds: readonly number[],
    lo: number,
    hi: number,
    afterDay: Temporal.PlainDate,
    throughDay: Temporal.PlainDate,
  ): boolean {
    for (let index = monthIndex(throughDay) + 1; ; index++) {
      const [year, month] = yearMonthAt(index);
      const monthFirst = dayAt(year, month, 1, timezone);

      if (
        Temporal.PlainDate.compare(
          addDays(monthFirst, -SHIFT_SEARCH_LIMIT_DAYS, timezone),
          throughDay,
        ) > 0
      ) {
        return false;
      }

      const landed = landedDaysIn(schedule, year, month);

      if (hasInstantIn(landed, seconds, lo, hi, afterDay, throughDay)) {
        return true;
      }

      const first = landed[0];

      if (first !== undefined && Temporal.PlainDate.compare(first, throughDay) > 0) {
        return false;
      }
    }
  }

  /**
   * The base days of the month (the AND of years / months / days,
   * filtered by if) mapped to their shift landing days, ascending.
   * Consecutive base days collapse into the same landing day.
   */
  function landedDaysIn(schedule: YrnkSchedule, year: number, month: number): Temporal.PlainDate[] {
    if (schedule.years !== undefined && !schedule.years.includes(year)) {
      return [];
    }

    if (schedule.months !== undefined && !schedule.months.includes(month)) {
      return [];
    }

    const dayNumbers =
      schedule.days === undefined
        ? wholeMonth(year, month)
        : enumerateAtomDays(schedule, year, month);
    const landed: Temporal.PlainDate[] = [];

    for (const dayNumber of dayNumbers) {
      const base = dayAt(year, month, dayNumber, timezone);

      if (!passesIf(schedule, base)) {
        continue;
      }

      const day = schedule.shift === undefined ? base : landingOf(schedule.shift, base);

      if (day === null) {
        continue;
      }

      const previous = landed[landed.length - 1];

      if (previous?.equals(day)) {
        continue;
      }

      landed.push(day);
    }

    return landed;
  }

  function wholeMonth(year: number, month: number): number[] {
    const limit = dayAt(year, month, 1, timezone).daysInMonth;

    return Array.from({ length: limit }, (_, index) => index + 1);
  }

  /**
   * The union of the atom enumerations (OR). Only the day cycle counts
   * from the schedule's from, so it is enumerated here; everything else
   * is delegated to the enumerator.
   */
  function enumerateAtomDays(schedule: YrnkSchedule, year: number, month: number): number[] {
    const seen = new Set<number>();

    for (const atom of schedule.days ?? []) {
      const days =
        atom.kind === 'day-cycle'
          ? cycleDaysIn(schedule, atom.interval, year, month)
          : atomDaysIn(atom, year, month, timezone, resolved);

      for (const day of days) {
        seen.add(day);
      }
    }

    return [...seen].sort((a, b) => a - b);
  }

  /**
   * The day cycle's matching day numbers (that month's part): every Nth
   * day counting the from date as day one, computed arithmetically from
   * the day difference between the first of the month and from.
   */
  function cycleDaysIn(
    schedule: YrnkSchedule,
    interval: number,
    year: number,
    month: number,
  ): number[] {
    const anchor = anchorOf(schedule);

    if (anchor === null) {
      return [];
    }

    const first = dayAt(year, month, 1, timezone);
    const offset = daysBetween(anchor.toPlainDate(), first);
    let startDay: number;

    if (offset <= 0) {
      // The from day is on or after the first of the month (the count
      // starts in this month or later).
      startDay = 1 - offset;
    } else {
      const remainder = offset % interval;

      startDay = 1 + (remainder === 0 ? 0 : interval - remainder);
    }

    const days: number[] = [];

    for (let day = startDay; day <= first.daysInMonth; day += interval) {
      days.push(day);
    }

    return days;
  }

  /**
   * Among the landing days overlapping the period, is there a time point
   * in [lo, hi]? Days strictly inside afterDay and throughDay always
   * have their time points inside the period (points exist only within
   * the day), so only the boundary days need their times checked.
   */
  function hasInstantIn(
    days: readonly Temporal.PlainDate[],
    seconds: readonly number[],
    lo: number,
    hi: number,
    afterDay: Temporal.PlainDate,
    throughDay: Temporal.PlainDate,
  ): boolean {
    for (const day of days) {
      if (
        Temporal.PlainDate.compare(afterDay, day) > 0 ||
        Temporal.PlainDate.compare(day, throughDay) > 0
      ) {
        continue;
      }

      if (!day.equals(afterDay) && !day.equals(throughDay)) {
        return true;
      }

      for (const second of seconds) {
        const instant = epochSecOf(atTime(day, second, timezone));

        if (instant >= lo && instant <= hi) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * The single-day decision (the day part of matches). With a shift, "is
   * there a base day that lands on this day" is checked by walking the
   * candidates opposite to the shift direction and verifying with the
   * forward landing computation.
   */
  function dayMatches(schedule: YrnkSchedule, date: Temporal.PlainDate): boolean {
    if (schedule.shift === undefined) {
      return isBaseDay(schedule, date);
    }

    // A landing day always satisfies the landing condition.
    if (!atomMatches(schedule.shift.condition, date, resolved)) {
      return false;
    }

    // Candidate base days run from date, opposite to the shift
    // direction, up to the next landing-condition day after date (base
    // days beyond it fall there or further).
    const step = schedule.shift.direction === 'next' ? -1 : 1;
    let cursor = date;

    for (let i = 0; i <= SHIFT_SEARCH_LIMIT_DAYS; i++) {
      if (isBaseDay(schedule, cursor) && landsOn(schedule.shift, cursor, date)) {
        return true;
      }

      cursor = addDays(cursor, step, timezone);

      if (atomMatches(schedule.shift.condition, cursor, resolved)) {
        // For a strict shift (without or_same), this landing-condition
        // day itself is the last candidate that can fall on date.
        return (
          !schedule.shift.orSame &&
          isBaseDay(schedule, cursor) &&
          landsOn(schedule.shift, cursor, date)
        );
      }
    }

    return false;
  }

  /**
   * Where a zone skips a calendar day outright, the occurrence chosen
   * for that day stands on the day it resolves to. The day check reads a
   * day off the instant and asks whether that day matches, so it never
   * sees the day that vanished — the enumeration, which chooses days on
   * the calendar before resolving them, is asked instead. The question
   * is only put when a day really did vanish into this one.
   */
  function vanishedDayLandsOn(schedule: YrnkSchedule, day: Temporal.PlainDate): boolean {
    if (!addDays(day, -1, timezone).equals(day)) {
      return false;
    }

    return landedDaysWithin(schedule, day, day).length > 0;
  }

  function isBaseDay(schedule: YrnkSchedule, date: Temporal.PlainDate): boolean {
    if (schedule.years !== undefined && !schedule.years.includes(date.year)) {
      return false;
    }

    if (schedule.months !== undefined && !schedule.months.includes(date.month)) {
      return false;
    }

    if (schedule.days !== undefined && !matchesAnyAtom(schedule, date)) {
      return false;
    }

    return passesIf(schedule, date);
  }

  function matchesAnyAtom(schedule: YrnkSchedule, date: Temporal.PlainDate): boolean {
    for (const atom of schedule.days ?? []) {
      const matched =
        atom.kind === 'day-cycle'
          ? matchesCycle(schedule, atom.interval, date)
          : atomMatches(atom, date, resolved);

      if (matched) {
        return true;
      }
    }

    return false;
  }

  /**
   * The day cycle decision: only days on or after the from date, a
   * multiple of N days away from it, match.
   */
  function matchesCycle(
    schedule: YrnkSchedule,
    interval: number,
    date: Temporal.PlainDate,
  ): boolean {
    const anchor = anchorOf(schedule);

    if (anchor === null) {
      return false;
    }

    const offset = daysBetween(anchor.toPlainDate(), date);

    return offset >= 0 && offset % interval === 0;
  }

  /**
   * if filters without moving the day; shift then moves the filtered
   * result as base days.
   */
  function passesIf(schedule: YrnkSchedule, date: Temporal.PlainDate): boolean {
    const guard = schedule.if;

    if (guard === undefined) {
      return true;
    }

    const target =
      guard.direction === null
        ? date
        : addDays(date, guard.direction === 'next' ? 1 : -1, timezone);
    const result = atomMatches(guard.condition, target, resolved);

    return guard.negated ? !result : result;
  }

  function landsOn(
    shift: YrnkShift,
    base: Temporal.PlainDate,
    target: Temporal.PlainDate,
  ): boolean {
    const landing = landingOf(shift, base);

    return landing?.equals(target) ?? false;
  }

  /**
   * The landing day of a base day (the forward landing computation).
   * Walks in the given direction until the landing condition holds.
   * or_same includes the base day itself; the strict form advances one
   * day before searching. The maximum displacement from the base day is
   * the same 366 days for both forms.
   */
  function landingOf(shift: YrnkShift, base: Temporal.PlainDate): Temporal.PlainDate | null {
    const step = shift.direction === 'next' ? 1 : -1;
    let cursor = shift.orSame ? base : addDays(base, step, timezone);

    for (
      let displacement = shift.orSame ? 0 : 1;
      displacement <= SHIFT_SEARCH_LIMIT_DAYS;
      displacement++
    ) {
      if (atomMatches(shift.condition, cursor, resolved)) {
        return cursor;
      }

      cursor = addDays(cursor, step, timezone);
    }

    return null;
  }

  /**
   * Does the day reach into [lo, hi] on the instant scale? A day carries
   * no time of its own, so a range holds it as soon as it holds any
   * instant of it.
   */
  function dayOverlaps(day: Temporal.PlainDate, lo: number, hi: number): boolean {
    const start = epochSecOf(atTime(day, 0, timezone));
    const end = epochSecOf(atTime(addDays(day, 1, timezone), 0, timezone)) - 1;

    return Math.max(start, lo) <= Math.min(end, hi);
  }

  function lastDayOf(year: number, month: number): Temporal.PlainDate {
    const first = dayAt(year, month, 1, timezone);

    return dayAt(year, month, first.daysInMonth, timezone);
  }

  /**
   * The row's points whose instants lie in [lo, hi] (epoch seconds), as
   * [firstWall, lastWall, offset] runs on the wall-epoch scale: the row
   * points firstWall, firstWall + step, …, lastWall, each resolving to
   * the instant wall − offset. Answered per offset segment: the wall
   * clock's offset to real time is piecewise-constant, so within one
   * segment wall order and instant order agree and the question reduces
   * to intersecting integer ranges. Runs of different segments can
   * interleave in instant terms (a pushed run stands past a later
   * segment's first instants).
   */
  function sequencePointRunsIn(
    schedule: YrnkSchedule,
    every: readonly [number, YrnkTimeUnit],
    lo: number,
    hi: number,
  ): (readonly [number, number, number])[] {
    const anchor = anchorOf(schedule);

    if (anchor === null || lo > hi) {
      return [];
    }

    const step = every[0] * UNIT_SECONDS[every[1]];
    const anchorWall = wallEpochOf(anchor);
    const runs: (readonly [number, number, number])[] = [];

    for (const [segmentStart, segmentEnd, offset] of wallOffsetSegments(lo, hi)) {
      let first = Math.max(segmentStart, lo + offset, anchorWall);
      let last = Math.min(segmentEnd - 1, hi + offset);

      if (first > last) {
        continue;
      }

      // Snap both ends onto the row (the first point at or after first,
      // the last at or before last).
      first = anchorWall + Math.trunc((first - anchorWall + step - 1) / step) * step;
      last = anchorWall + Math.trunc((last - anchorWall) / step) * step;

      if (first > last) {
        continue;
      }

      runs.push([first, last, offset]);
    }

    return runs;
  }

  /**
   * The points of the interval sequence lying in [lo, hi], ascending by
   * instant: the per-segment runs collected keyed by instant —
   * deduplicating points folded together by a DST gap and ordering
   * interleaved runs by instant at once.
   */
  function sequenceOccurrencesIn(
    schedule: YrnkSchedule,
    every: readonly [number, YrnkTimeUnit],
    lo: number,
    hi: number,
  ): Temporal.ZonedDateTime[] {
    const step = every[0] * UNIT_SECONDS[every[1]];
    const instants = new Map<number, Temporal.ZonedDateTime>();

    for (const [first, last, offset] of sequencePointRunsIn(schedule, every, lo, hi)) {
      for (let wall = first; wall <= last; wall += step) {
        const instant = wall - offset;

        // Wrapped from the instant rather than re-read from the wall
        // clock: an overlap wall time names two instants, and this is
        // the one the run resolved to.
        instants.set(
          instant,
          Temporal.Instant.fromEpochMilliseconds(instant * 1000).toZonedDateTimeISO(timezone),
        );
      }
    }

    return [...instants.entries()].sort((a, b) => a[0] - b[0]).map(([, zoned]) => zoned);
  }

  /**
   * The wall reading as seconds on a fake-UTC epoch scale (the wall
   * calendar laid out with no offsets) — the scale the sequence row and
   * the offset segments are intersected on.
   */
  function wallEpochOf(zoned: Temporal.ZonedDateTime): number {
    return Math.floor(zoned.toPlainDateTime().toZonedDateTime('UTC').epochMilliseconds / 1000);
  }

  /**
   * The wall clock's offset regimes as [wallStart, wallEnd, offset]
   * segments (wall-epoch bounds, end exclusive) covering every wall time
   * that can resolve into the instant range [lo, hi]. The offset applied
   * to a wall time changes at the boundary wall b = transition instant +
   * max(offset before, offset after): below b the earlier offset applies
   * — which both pushes gap wall times forward and reads an overlap wall
   * time as its first occurrence (RFC 5545 §3.3.5).
   */
  function wallOffsetSegments(lo: number, hi: number): (readonly [number, number, number])[] {
    const limitNs = BigInt(hi + WALL_OFFSET_SLACK_SECONDS) * 1_000_000_000n;
    let cursor = Temporal.Instant.fromEpochMilliseconds(
      (lo - WALL_OFFSET_SLACK_SECONDS) * 1000,
    ).toZonedDateTimeISO(timezone);
    const segments: (readonly [number, number, number])[] = [];
    let start = -Infinity;
    let offset = cursor.offsetNanoseconds / 1_000_000_000;

    for (;;) {
      const next = cursor.getTimeZoneTransition('next');

      if (next === null || next.epochNanoseconds > limitNs) {
        break;
      }

      const transitionSec = Number(next.epochNanoseconds / 1_000_000_000n);
      const nextOffset = next.offsetNanoseconds / 1_000_000_000;
      const boundary = transitionSec + Math.max(offset, nextOffset);

      segments.push([start, boundary, offset]);
      start = boundary;
      offset = nextOffset;
      cursor = next;
    }

    segments.push([start, Infinity, offset]);

    return segments;
  }

  return { matchesAt, hasPointIn, collectIn };
}
