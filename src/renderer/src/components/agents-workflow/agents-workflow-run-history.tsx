import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunStatus,
  AgentsWorkflowRunSummary
} from '../../../../shared/agents-workflow-run-types'

export function AgentsWorkflowRunHistory({
  runs,
  selectedRun,
  hasMore,
  onSelect,
  onLoadMore,
  onCancel
}: {
  runs: AgentsWorkflowRunSummary[]
  selectedRun: AgentsWorkflowRun | null
  hasMore: boolean
  onSelect: (runId: string) => void
  onLoadMore: () => void
  onCancel: (runId: string) => void
}): React.JSX.Element {
  return (
    <section className="grid h-64 shrink-0 grid-cols-[18rem_minmax(0,1fr)] border-t border-border bg-card">
      <div className="overflow-y-auto border-r border-border p-3 scrollbar-sleek">
        <div className="mb-2 text-xs font-semibold">
          {translate('auto.components.agents-workflow.history.title', 'Run history')}
        </div>
        {runs.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {translate('auto.components.agents-workflow.history.empty', 'No runs yet.')}
          </div>
        ) : (
          <div className="space-y-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                data-current={selectedRun?.id === run.id ? 'true' : undefined}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent data-[current=true]:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onSelect(run.id)}
              >
                <span className="truncate">{runStatusLabel(run.status)}</span>
                <span className="shrink-0 text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  }).format(run.createdAt)}
                </span>
              </button>
            ))}
          </div>
        )}
        {hasMore ? (
          <Button variant="ghost" size="xs" className="mt-2 w-full" onClick={onLoadMore}>
            {translate('auto.components.agents-workflow.history.more', 'Load more')}
          </Button>
        ) : null}
      </div>
      <RunDetail run={selectedRun} onCancel={onCancel} />
    </section>
  )
}

function RunDetail({
  run,
  onCancel
}: {
  run: AgentsWorkflowRun | null
  onCancel: (runId: string) => void
}): React.JSX.Element {
  if (!run) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {translate(
          'auto.components.agents-workflow.history.select',
          'Select a run to inspect attempts and output.'
        )}
      </div>
    )
  }
  const active =
    run.status === 'pending' || run.status === 'running' || run.status === 'cancel_requested'
  return (
    <div className="min-w-0 overflow-y-auto p-4 scrollbar-sleek">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{runStatusLabel(run.status)}</div>
          <div className="text-xs text-muted-foreground">
            {translate(
              'auto.components.agents-workflow.history.revision',
              'Definition revision {{revision}}',
              { revision: run.workflowRevision }
            )}
          </div>
        </div>
        {active ? (
          <Button variant="outline" size="xs" onClick={() => onCancel(run.id)}>
            {translate('auto.components.agents-workflow.history.cancel', 'Cancel run')}
          </Button>
        ) : null}
      </div>
      {run.skipReason ? (
        <div className="mb-3 text-xs text-muted-foreground">
          {run.skipReason === 'active_run'
            ? translate(
                'auto.components.agents-workflow.history.skippedActive',
                'Skipped because another run was active.'
              )
            : translate(
                'auto.components.agents-workflow.history.skippedGrace',
                'Skipped because the missed-run grace period elapsed.'
              )}
        </div>
      ) : null}
      <div className="space-y-3">
        {run.attempts.map((attempt) => (
          <div key={attempt.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">{attempt.nodeId}</span>
              <span className="text-muted-foreground">{attemptStatusLabel(attempt.status)}</span>
            </div>
            {attempt.output ? (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
                {attempt.output.content}
              </pre>
            ) : null}
            {attempt.errorMessage ? (
              <div className="mt-2 text-xs text-destructive">{attempt.errorMessage}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function runStatusLabel(status: AgentsWorkflowRunStatus): string {
  const labels: Record<AgentsWorkflowRunStatus, string> = {
    pending: translate('auto.components.agents-workflow.history.pending', 'Pending'),
    running: translate('auto.components.agents-workflow.history.running', 'Running'),
    cancel_requested: translate('auto.components.agents-workflow.history.cancelling', 'Cancelling'),
    completed: translate('auto.components.agents-workflow.history.completed', 'Completed'),
    failed: translate('auto.components.agents-workflow.history.failed', 'Failed'),
    cancelled: translate('auto.components.agents-workflow.history.cancelled', 'Cancelled'),
    skipped: translate('auto.components.agents-workflow.history.skipped', 'Skipped'),
    unverifiable: translate('auto.components.agents-workflow.history.unverifiable', 'Unverifiable')
  }
  return labels[status]
}

function attemptStatusLabel(status: AgentsWorkflowRun['attempts'][number]['status']): string {
  const labels: Record<AgentsWorkflowRun['attempts'][number]['status'], string> = {
    pending: translate('auto.components.agents-workflow.history.attemptPending', 'Pending'),
    running: translate('auto.components.agents-workflow.history.attemptRunning', 'Running'),
    completed: translate('auto.components.agents-workflow.history.attemptCompleted', 'Completed'),
    failed: translate('auto.components.agents-workflow.history.attemptFailed', 'Failed'),
    skipped: translate('auto.components.agents-workflow.history.attemptSkipped', 'Skipped'),
    cancelled: translate('auto.components.agents-workflow.history.attemptCancelled', 'Cancelled'),
    unverifiable: translate(
      'auto.components.agents-workflow.history.attemptUnverifiable',
      'Unverifiable'
    )
  }
  return labels[status]
}
