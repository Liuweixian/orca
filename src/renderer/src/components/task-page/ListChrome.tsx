import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import { cn } from '@/lib/utils'
import { TaskPageSourceBar } from './SourceBar'
import { AlertCircle } from 'lucide-react'
import { TaskPageGitHubModeControls } from './github/ModeControls'
import { TaskPageProviderFilters } from './ProviderFilters'
export function TaskPageListChrome({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const { taskSourceAvailabilityNotice, taskPageListChromeHidden, taskPageBrowserActive } = model
  return (
    // Why: the browser tab hosts its own controls, so provider mode/filters must not stack above it,
    // while the source bar (with the browser tab button) stays visible to switch back.
    <div
      className={cn(
        'flex-none flex flex-col gap-2',
        taskPageListChromeHidden && !taskPageBrowserActive && 'hidden'
      )}
    >
      <section className="flex flex-col gap-2">
        <div className="flex flex-col gap-2">
          <TaskPageSourceBar model={model} />

          {taskSourceAvailabilityNotice ? (
            <div
              role="status"
              className="flex max-w-3xl items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              title={taskSourceAvailabilityNotice.title}
            >
              <AlertCircle className="size-3.5 flex-none" />
              <span className="min-w-0 truncate">{taskSourceAvailabilityNotice.label}</span>
            </div>
          ) : null}

          {!taskPageBrowserActive ? (
            <>
              <TaskPageGitHubModeControls model={model} />

              <TaskPageProviderFilters model={model} />
            </>
          ) : null}
        </div>
      </section>
    </div>
  )
}
