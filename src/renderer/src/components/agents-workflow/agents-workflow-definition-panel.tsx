import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowSchedule
} from '../../../../shared/agents-workflow-types'
import type { AgentsWorkflowValidationIssue } from '../../../../shared/agents-workflow-graph'
import type { AutomationDraft } from '../automations/AutomationEditorDialog'
import { AutomationSchedulePicker } from '../automations/AutomationSchedulePicker'
import { AgentsWorkflowTargetFields } from './agents-workflow-target-fields'
import { rruleFromScheduleDraft, toScheduleDraft } from './agents-workflow-schedule-draft'

/** Below a minute, any tick jitter would mark the occurrence missed before it could start. */
const MIN_GRACE_MINUTES = 1
const MAX_GRACE_MINUTES = 7 * 24 * 60

export function AgentsWorkflowDefinitionPanel({
  workflows,
  definition,
  issues,
  onSelect,
  onCreate,
  onChange
}: {
  workflows: AgentsWorkflowDefinition[]
  definition: AgentsWorkflowDefinition
  issues: readonly AgentsWorkflowValidationIssue[]
  onSelect: (id: string) => void
  onCreate: () => void
  onChange: (definition: AgentsWorkflowDefinition) => void
}): React.JSX.Element {
  const scheduleDraft = toScheduleDraft(definition.trigger.schedule)
  // Why shown here: issues without a node or edge have nowhere else to appear, so clearing the
  // name or picking an unsupported host used to disable Run with no visible reason.
  const workflowIssues = issues.filter(
    (issue) => issue.nodeId === undefined && issue.edgeId === undefined
  )
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-border bg-card p-4 scrollbar-sleek">
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <Select value={definition.id} onValueChange={onSelect}>
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={translate('auto.components.agents-workflow.definition.new', 'New workflow')}
            onClick={onCreate}
          >
            <Plus />
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="agents-workflow-name">
            {translate('auto.components.agents-workflow.definition.name', 'Name')}
          </Label>
          <Input
            id="agents-workflow-name"
            value={definition.name}
            onChange={(event) =>
              onChange({ ...definition, name: event.target.value, updatedAt: Date.now() })
            }
          />
        </div>
        {workflowIssues.length > 0 ? (
          <section className="space-y-1">
            <div className="text-xs font-semibold text-destructive">
              {translate('auto.components.agents-workflow.inspector.issues', 'Issues')}
            </div>
            <ul className="space-y-1 text-xs">
              {workflowIssues.map((issue) => (
                <li
                  key={`${issue.code}:${issue.message}`}
                  className={
                    issue.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'
                  }
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <AgentsWorkflowTargetFields definition={definition} onChange={onChange} />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="agents-workflow-enabled">
            {translate('auto.components.agents-workflow.definition.enabled', 'Enabled')}
          </Label>
          <Switch
            id="agents-workflow-enabled"
            checked={definition.enabled}
            onCheckedChange={(enabled) =>
              onChange({ ...definition, enabled, updatedAt: Date.now() })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="agents-workflow-schedule-enabled">
            {translate('auto.components.agents-workflow.definition.schedule', 'Scheduled runs')}
          </Label>
          <Switch
            id="agents-workflow-schedule-enabled"
            checked={definition.trigger.schedule !== null}
            onCheckedChange={(enabled) =>
              onChange({
                ...definition,
                trigger: {
                  ...definition.trigger,
                  schedule: enabled ? defaultSchedule() : null
                },
                updatedAt: Date.now()
              })
            }
          />
        </div>
        {definition.trigger.schedule ? (
          <ScheduleFields definition={definition} draft={scheduleDraft} onChange={onChange} />
        ) : null}
      </div>
    </aside>
  )
}

function ScheduleFields({
  definition,
  draft,
  onChange
}: {
  definition: AgentsWorkflowDefinition
  draft: AutomationDraft
  onChange: (definition: AgentsWorkflowDefinition) => void
}): React.JSX.Element | null {
  const schedule = definition.trigger.schedule
  if (!schedule) {
    return null
  }
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <AutomationSchedulePicker
        draft={draft}
        allowCustom={false}
        onDraftChange={(update) => {
          const rrule = rruleFromScheduleDraft(update(draft))
          updateSchedule(definition, { ...schedule, rrule }, onChange)
        }}
      />
      <div className="space-y-2">
        <Label htmlFor="agents-workflow-timezone">
          {translate('auto.components.agents-workflow.definition.timezone', 'Timezone')}
        </Label>
        <Select
          value={schedule.timezone}
          onValueChange={(timezone) =>
            updateSchedule(definition, { ...schedule, timezone }, onChange)
          }
        >
          <SelectTrigger id="agents-workflow-timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timezoneOptions(schedule.timezone).map((timezone) => (
              <SelectItem key={timezone} value={timezone}>
                {timezone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="agents-workflow-grace">
          {translate(
            'auto.components.agents-workflow.definition.grace',
            'Missed-run grace (minutes)'
          )}
        </Label>
        <Input
          id="agents-workflow-grace"
          type="number"
          min={MIN_GRACE_MINUTES}
          max={MAX_GRACE_MINUTES}
          value={schedule.missedRunGraceMinutes}
          onChange={(event) => {
            // Why clamp: an empty field reads as 0, which would mark every occurrence missed.
            const parsed = Number.parseInt(event.target.value, 10)
            if (!Number.isFinite(parsed)) {
              return
            }
            updateSchedule(
              definition,
              {
                ...schedule,
                missedRunGraceMinutes: Math.min(
                  MAX_GRACE_MINUTES,
                  Math.max(MIN_GRACE_MINUTES, parsed)
                )
              },
              onChange
            )
          }}
        />
      </div>
    </div>
  )
}

function updateSchedule(
  definition: AgentsWorkflowDefinition,
  schedule: AgentsWorkflowSchedule,
  onChange: (definition: AgentsWorkflowDefinition) => void
): void {
  onChange({
    ...definition,
    trigger: { ...definition.trigger, schedule },
    updatedAt: Date.now()
  })
}

function defaultSchedule(): AgentsWorkflowSchedule {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: Date.now(),
    missedRunGraceMinutes: 60
  }
}

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney'
]

/**
 * The choices offered by the timezone picker. Why a select and not a text field: a typo is only
 * rejected by the host at save time, long after the author moved on.
 */
function timezoneOptions(current: string): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf?.('timeZone')
  const zones = supported && supported.length > 0 ? [...supported] : [...FALLBACK_TIMEZONES]
  // Why keep the current zone: a schedule saved in a zone this build does not list must stay
  // selectable instead of silently changing on the next edit.
  if (!zones.includes(current)) {
    zones.unshift(current)
  }
  return zones
}
