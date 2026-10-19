import { Bot, GitBranch, Play, Repeat2, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'

export type AgentsWorkflowNodeKindToAdd = 'agent' | 'condition' | 'loop'

export function AgentsWorkflowTopBar({
  name,
  errorCount,
  dirty,
  saving,
  running,
  runInput,
  onAddNode,
  onSave,
  onDelete,
  onRunInputChange,
  onRun,
  onExport
}: {
  name: string
  errorCount: number
  dirty: boolean
  saving: boolean
  running: boolean
  runInput: string
  onAddNode: (kind: AgentsWorkflowNodeKindToAdd) => void
  onSave: () => void
  onDelete: () => void
  onRunInputChange: (input: string) => void
  onRun: () => void
  onExport: () => void
}): React.JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="text-xs text-muted-foreground">
          {errorCount === 0
            ? translate('auto.components.agents-workflow.topbar.valid', 'Ready to save')
            : translate('auto.components.agents-workflow.topbar.errors', '{{count}} issues', {
                count: errorCount
              })}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" onClick={() => onAddNode('agent')}>
          <Bot />
          {translate('auto.components.agents-workflow.topbar.addAgent', 'Agent')}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onAddNode('condition')}>
          <GitBranch />
          {translate('auto.components.agents-workflow.topbar.addCondition', 'Condition')}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onAddNode('loop')}>
          <Repeat2 />
          {translate('auto.components.agents-workflow.topbar.addLoop', 'Loop')}
        </Button>
      </div>
      <Button variant="outline" size="xs" onClick={onExport}>
        {translate('auto.components.agents-workflow.topbar.export', 'Copy JSON')}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={translate('auto.components.agents-workflow.topbar.delete', 'Delete workflow')}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
      <Button size="xs" disabled={!dirty || saving} onClick={onSave}>
        <Save />
        {saving
          ? translate('auto.components.agents-workflow.topbar.saving', 'Saving')
          : translate('auto.components.agents-workflow.topbar.save', 'Save')}
      </Button>
      <Input
        className="h-6 w-48"
        value={runInput}
        aria-label={translate('auto.components.agents-workflow.topbar.runInput', 'Run input')}
        placeholder={translate(
          'auto.components.agents-workflow.topbar.runInputPlaceholder',
          'Manual run input'
        )}
        onChange={(event) => onRunInputChange(event.target.value)}
      />
      <Button size="xs" disabled={errorCount > 0 || dirty || running} onClick={onRun}>
        <Play />
        {running
          ? translate('auto.components.agents-workflow.topbar.starting', 'Starting')
          : translate('auto.components.agents-workflow.topbar.run', 'Run')}
      </Button>
    </header>
  )
}
