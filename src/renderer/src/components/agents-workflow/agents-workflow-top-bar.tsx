import { Play, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function AgentsWorkflowTopBar({
  name,
  target,
  errorCount,
  warningCount,
  dirty,
  saving,
  running,
  onSave,
  onDelete,
  onRun,
  onExport
}: {
  name: string
  target: string
  errorCount: number
  warningCount: number
  dirty: boolean
  saving: boolean
  running: boolean
  onSave: () => void
  onDelete: () => void
  onRun: () => void
  onExport: () => void
}): React.JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          {target ? <span className="truncate text-xs text-muted-foreground">{target}</span> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {errorCount > 0
            ? translate(
                'auto.components.agents-workflow.topbar.draft',
                '{{count}} issues · saved as draft, Run is disabled',
                { count: errorCount }
              )
            : warningCount > 0
              ? translate('auto.components.agents-workflow.topbar.warnings', '{{count}} warnings', {
                  count: warningCount
                })
              : translate('auto.components.agents-workflow.topbar.valid', 'Ready to run')}
        </div>
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
      <Button size="xs" disabled={errorCount > 0 || dirty || running} onClick={onRun}>
        <Play />
        {running
          ? translate('auto.components.agents-workflow.topbar.starting', 'Starting')
          : translate('auto.components.agents-workflow.topbar.run', 'Run')}
      </Button>
    </header>
  )
}
