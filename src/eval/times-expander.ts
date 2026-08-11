import type { YrnkTimeSpec, YrnkTimeUnit } from '../model.ts';
import { timeToSeconds } from '../parse/times.ts';
import type { ResolvedCalendar } from './resolved-calendar.ts';

const UNIT_SECONDS: Readonly<Record<YrnkTimeUnit, number>> = { hour: 3600, minute: 60, second: 1 };

/**
 * Expansion of times into the scheduled points within one day (seconds
 * from midnight, ascending). The grid anchors at the start of each
 * window; windows are the half-open interval [start, end). The two time
 * parts that lay out no point within a day never reach here — allday and
 * the interval every are decided by the finder before it asks.
 */
export function secondsOf(
  time: Extract<YrnkTimeSpec, { kind: 'times' | 'grid' }>,
  resolved: ResolvedCalendar,
): readonly number[] {
  if (time.kind === 'times') {
    return time.times.map(timeToSeconds).sort((a, b) => a - b);
  }

  const [amount, unit] = time.every;
  const step = amount * UNIT_SECONDS[unit];
  const windows: readonly (readonly [number, number])[] =
    time.between === null
      ? [[0, 86400]]
      : time.between === 'business_hour'
        ? resolved.businessHourWindows()
        : [
            [
              timeToSeconds(time.between[0]),
              time.between[1] === '24:00' ? 86400 : timeToSeconds(time.between[1]),
            ],
          ];
  const points: number[] = [];

  for (const [start, end] of windows) {
    for (let t = start; t < end; t += step) {
      points.push(t);
    }
  }

  return points.sort((a, b) => a - b);
}
