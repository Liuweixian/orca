import { parseSchedule } from '../../shared/automation-schedule-parsing'
import type { AgentsWorkflowSchedule } from '../../shared/agents-workflow-types'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
/** A weekly rule's latest occurrence is at most seven days back; one spare day covers DST. */
const MAX_SCAN_DAYS = 8
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

type WallClock = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

/**
 * The occurrences at or before `now`, newest first.
 *
 * Why derive candidates instead of scanning minute by minute: a weekly rule five days stale would
 * otherwise cost thousands of `Intl` format calls on every tick, for every enabled workflow. Here
 * the search walks back at most one candidate per day (or per hour for an hourly rule), and only
 * as far as `MAX_SCAN_DAYS`, which is why callers treat a longer gap as out of view.
 */
export function* agentsWorkflowOccurrencesDescending(
  schedule: AgentsWorkflowSchedule,
  now: number
): Generator<number> {
  if (now < schedule.dtstart) {
    return
  }
  const rule = parseSchedule(schedule.rrule)
  if (rule.kind !== 'rrule') {
    // Why not throw: this runs every minute, and a throw only produced a log line per tick for a
    // workflow that could never run. The store already refuses to save such a schedule; a legacy
    // row simply has no occurrences on this build.
    return
  }
  const formatter = createFormatter(schedule.timezone)
  // An hourly rule without BYHOUR means every hour; with BYHOUR it means that hour each day.
  const hours =
    rule.freq === 'HOURLY' && !rule.byHourDeclared
      ? Array.from({ length: 24 }, (_, hour) => hour)
      : [rule.byHour]
  const localToday = formatWallClock(formatter, now)
  const todayInUtc = Date.UTC(localToday.year, localToday.month - 1, localToday.day)

  for (let daysBack = 0; daysBack < MAX_SCAN_DAYS; daysBack += 1) {
    const calendarDay = new Date(todayInUtc - daysBack * DAY_MS)
    const day = calendarDay.getUTCDate()
    const month = calendarDay.getUTCMonth() + 1
    const year = calendarDay.getUTCFullYear()
    if (rule.freq === 'WEEKLY' && !rule.byDay.includes(DAY_CODES[calendarDay.getUTCDay()])) {
      continue
    }
    const candidates = hours
      .flatMap((hour) => {
        const candidate = zonedTimestampRollingForward(formatter, {
          year,
          month,
          day,
          hour,
          minute: rule.byMinute
        })
        return candidate !== null && candidate <= now && candidate >= schedule.dtstart
          ? [candidate]
          : []
      })
      .sort((left, right) => right - left)
    yield* candidates
    // Why stop: candidates only get older, so a day whose last slot predates dtstart ends the search.
    const endOfDay = zonedTimestamp(formatter, { year, month, day, hour: 23, minute: 59 })
    if (endOfDay !== null && endOfDay < schedule.dtstart) {
      break
    }
  }
}

/** The latest occurrence at or before `now` in the schedule's timezone. */
export function latestAgentsWorkflowOccurrence(
  schedule: AgentsWorkflowSchedule,
  now: number
): number | null {
  const first = agentsWorkflowOccurrencesDescending(schedule, now).next()
  return first.done ? null : first.value
}

function createFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  })
}

function formatWallClock(formatter: Intl.DateTimeFormat, timestamp: number): WallClock {
  const values = new Map(
    formatter
      .formatToParts(timestamp)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute'))
  }
}

/** The zone's offset at a wall-clock time, as `local time interpreted as UTC - epoch`. */
function timezoneOffsetMs(formatter: Intl.DateTimeFormat, timestamp: number): number {
  const floored = Math.floor(timestamp / MINUTE_MS) * MINUTE_MS
  const parts = formatWallClock(formatter, floored)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - floored
}

const MAX_DST_ROLL_FORWARD_MINUTES = 3 * 60

/**
 * The epoch millisecond of a wall-clock time, or the first existing minute after it.
 *
 * Why roll forward: a spring-forward gap silently erased a daily rule that named 02:30. Running
 * at 03:00 keeps the day's occurrence instead of losing it until the next day.
 */
function zonedTimestampRollingForward(
  formatter: Intl.DateTimeFormat,
  wallClock: WallClock
): number | null {
  const direct = zonedTimestamp(formatter, wallClock)
  if (direct !== null) {
    return direct
  }
  const start = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute
  )
  for (let minute = 1; minute <= MAX_DST_ROLL_FORWARD_MINUTES; minute += 1) {
    const probe = new Date(start + minute * MINUTE_MS)
    const candidate = zonedTimestamp(formatter, {
      year: probe.getUTCFullYear(),
      month: probe.getUTCMonth() + 1,
      day: probe.getUTCDate(),
      hour: probe.getUTCHours(),
      minute: probe.getUTCMinutes()
    })
    if (candidate !== null) {
      return candidate
    }
  }
  return null
}

/** The epoch millisecond of a wall-clock time in the schedule's zone, or null if it does not exist. */
function zonedTimestamp(formatter: Intl.DateTimeFormat, wallClock: WallClock): number | null {
  const asUtc = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute
  )
  // Why twice: the offset read at the guessed instant may be the wrong side of a DST transition.
  const timestamp = asUtc - timezoneOffsetMs(formatter, asUtc - timezoneOffsetMs(formatter, asUtc))
  const actual = formatWallClock(formatter, timestamp)
  return actual.year === wallClock.year &&
    actual.month === wallClock.month &&
    actual.day === wallClock.day &&
    actual.hour === wallClock.hour &&
    actual.minute === wallClock.minute
    ? timestamp
    : null
}
