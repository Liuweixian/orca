import { parseSchedule } from '../../shared/automation-schedule-parsing'
import type { AgentsWorkflowSchedule } from '../../shared/agents-workflow-types'

const MINUTE_MS = 60_000
const MAX_SCAN_MINUTES = 8 * 24 * 60
const DAY_CODES: Record<string, string> = {
  Sun: 'SU',
  Mon: 'MO',
  Tue: 'TU',
  Wed: 'WE',
  Thu: 'TH',
  Fri: 'FR',
  Sat: 'SA'
}

export function latestAgentsWorkflowOccurrence(
  schedule: AgentsWorkflowSchedule,
  now: number
): number | null {
  if (now < schedule.dtstart) {
    return null
  }
  const rule = parseSchedule(schedule.rrule)
  if (rule.kind !== 'rrule') {
    throw new Error('Agent workflow schedules require RRULE syntax.')
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  })
  let candidate = Math.floor(now / MINUTE_MS) * MINUTE_MS
  for (let scanned = 0; scanned < MAX_SCAN_MINUTES && candidate >= schedule.dtstart; scanned += 1) {
    const parts = zonedParts(formatter, candidate)
    if (
      parts.minute === rule.byMinute &&
      (rule.freq === 'HOURLY' || parts.hour === rule.byHour) &&
      (rule.freq !== 'WEEKLY' || rule.byDay.includes(parts.day))
    ) {
      return candidate
    }
    candidate -= MINUTE_MS
  }
  return null
}

function zonedParts(
  formatter: Intl.DateTimeFormat,
  timestamp: number
): { day: string; hour: number; minute: number } {
  const values = new Map(
    formatter
      .formatToParts(timestamp)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )
  return {
    day: DAY_CODES[values.get('weekday') ?? ''] ?? '',
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute'))
  }
}
