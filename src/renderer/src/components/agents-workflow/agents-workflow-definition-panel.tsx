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
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowSchedule
} from '../../../../shared/agents-workflow-types'
import { buildAutomationRrule } from '../../../../shared/automation-schedule-occurrences'
import { tryParseAutomationRrule } from '../../../../shared/automation-schedule-parsing'
import type { AutomationDraft } from '../automations/AutomationEditorDialog'
import { AutomationSchedulePicker } from '../automations/AutomationSchedulePicker'
import { AgentsWorkflowTargetFields } from './agents-workflow-target-fields'

export function AgentsWorkflowDefinitionPanel({
  workflows,
  definition,
  onSelect,
  onCreate,
  onChange
}: {
  workflows: AgentsWorkflowDefinition[]
  definition: AgentsWorkflowDefinition
  onSelect: (id: string) => void
  onCreate: () => void
  onChange: (definition: AgentsWorkflowDefinition) => void
}): React.JSX.Element {
  const scheduleDraft = toScheduleDraft(definition.trigger.schedule)
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
        <AgentsWorkflowTargetFields definition={definition} onChange={onChange} />
        <div className="space-y-2">
          <Label htmlFor="agents-workflow-default-input">
            {translate(
              'auto.components.agents-workflow.definition.defaultInput',
              'Default scheduled input'
            )}
          </Label>
          <Textarea
            id="agents-workflow-default-input"
            value={definition.trigger.defaultInput}
            onChange={(event) =>
              onChange({
                ...definition,
                trigger: { ...definition.trigger, defaultInput: event.target.value },
                updatedAt: Date.now()
              })
            }
          />
        </div>
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
          const next = update(draft)
          const [hour, minute] = next.time.split(':').map(Number)
          const rrule = buildAutomationRrule({
            preset: next.preset === 'custom' ? 'daily' : next.preset,
            hour: Number.isFinite(hour) ? hour : 9,
            minute: Number.isFinite(minute) ? minute : 0,
            dayOfWeek: Number(next.dayOfWeek)
          })
          updateSchedule(definition, { ...schedule, rrule }, onChange)
        }}
      />
      <div className="space-y-2">
        <Label htmlFor="agents-workflow-timezone">
          {translate('auto.components.agents-workflow.definition.timezone', 'Timezone')}
        </Label>
        <Input
          id="agents-workflow-timezone"
          value={schedule.timezone}
          onChange={(event) =>
            updateSchedule(definition, { ...schedule, timezone: event.target.value }, onChange)
          }
        />
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
          min={0}
          value={schedule.missedRunGraceMinutes}
          onChange={(event) =>
            updateSchedule(
              definition,
              {
                ...schedule,
                missedRunGraceMinutes: Math.max(0, Number(event.target.value))
              },
              onChange
            )
          }
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

function toScheduleDraft(schedule: AgentsWorkflowSchedule | null): AutomationDraft {
  const parsed = schedule ? tryParseAutomationRrule(schedule.rrule) : null
  const hour = parsed?.hour ?? 9
  const minute = parsed?.minute ?? 0
  return {
    name: '',
    prompt: '',
    agentId: 'claude',
    extraAgentArgs: '',
    projectId: '',
    workspaceMode: 'new_per_run',
    workspaceId: '',
    baseBranch: '',
    reuseSession: false,
    precheckCommand: '',
    precheckTimeoutSeconds: '',
    preset: parsed?.preset === 'custom' ? 'daily' : (parsed?.preset ?? 'daily'),
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    dayOfWeek: String(parsed?.dayOfWeek ?? 1),
    customSchedule: '',
    savedSchedule: schedule?.rrule ?? null,
    missedRunGraceMinutes: String(schedule?.missedRunGraceMinutes ?? 60),
    scheduleWarning: null
  }
}
