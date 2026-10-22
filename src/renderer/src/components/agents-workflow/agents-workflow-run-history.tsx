import { Copy, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowNodeOutput,
  AgentsWorkflowRunStatus,
  AgentsWorkflowRunSummary
} from '../../../../shared/agents-workflow-run-types'

export function AgentsWorkflowRunHistory({
  runs,
  selectedRun,
  hasMore,
  onSelect,
  onLoadMore,
  onCancel,
  onClearHistory
}: {
  runs: AgentsWorkflowRunSummary[]
  selectedRun: AgentsWorkflowRun | null
  hasMore: boolean
  onSelect: (runId: string) => void
  onLoadMore: () => void
  onCancel: (runId: string) => void
  onClearHistory: () => void
}): React.JSX.Element {
  return (
    <section className="grid h-64 shrink-0 grid-cols-[18rem_minmax(0,1fr)] border-t border-border bg-card">
      <div className="overflow-y-auto border-r border-border p-3 scrollbar-sleek">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold">
            {translate('auto.components.agents-workflow.history.title', 'Run history')}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={translate(
              'auto.components.agents-workflow.history.clear',
              'Clear run history'
            )}
            title={translate('auto.components.agents-workflow.history.clear', 'Clear run history')}
            disabled={runs.length === 0}
            onClick={onClearHistory}
          >
            <Trash2 />
          </Button>
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
          {run.errorMessage || run.errorCode ? (
            <div className="mt-1 space-y-0.5">
              {run.errorMessage ? (
                <div className="text-xs text-destructive">{run.errorMessage}</div>
              ) : null}
              {run.errorCode ? (
                <div className="font-mono text-xs text-muted-foreground">{run.errorCode}</div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {run.errorMessage || run.errorCode ? (
            <CopyErrorButton report={runErrorReport(run)} />
          ) : null}
          {active ? (
            <Button variant="outline" size="xs" onClick={() => onCancel(run.id)}>
              {translate('auto.components.agents-workflow.history.cancel', 'Cancel run')}
            </Button>
          ) : null}
        </div>
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
              <span className="flex items-center gap-1 text-muted-foreground">
                {attemptStatusLabel(attempt.status)}
                {attempt.errorMessage || attempt.errorCode ? (
                  <CopyErrorButton report={attemptErrorReport(run, attempt)} />
                ) : null}
              </span>
            </div>
            {attempt.output ? (
              <div className="mt-2 space-y-1">
                <div className="text-xs text-muted-foreground">
                  {outputSourceLabel(attempt.output.source)}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
                  {attempt.output.content}
                </pre>
              </div>
            ) : null}
            {attempt.errorMessage || attempt.errorCode ? (
              <div className="mt-2 space-y-0.5">
                {attempt.errorMessage ? (
                  <div className="text-xs text-destructive">{attempt.errorMessage}</div>
                ) : null}
                {attempt.errorCode ? (
                  <div className="font-mono text-xs text-muted-foreground">{attempt.errorCode}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Where a node's value came from, so a reader can weigh it. */
function outputSourceLabel(source: AgentsWorkflowNodeOutput['source']): string {
  switch (source) {
    case 'structured_assistant_message':
      return translate(
        'auto.components.agents-workflow.history.outputStructured',
        'Structured answer'
      )
    case 'agent_transcript':
      return translate(
        'auto.components.agents-workflow.history.outputTranscript',
        'Answer read from the agent transcript'
      )
    case 'agent_file_handoff':
      return translate(
        'auto.components.agents-workflow.history.outputFile',
        'Answer written to the workflow output file'
      )
    case 'terminal_snapshot':
      return translate(
        'auto.components.agents-workflow.history.outputTerminal',
        'Terminal output (not passed downstream)'
      )
    case 'unknown':
      return translate(
        'auto.components.agents-workflow.history.outputUnknown',
        'Answer from an unrecognised source'
      )
  }
}

function CopyErrorButton({ report }: { report: string }): React.JSX.Element {
  const label = translate('auto.components.agents-workflow.history.copyError', 'Copy error details')
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={() => {
        void window.api.ui
          .writeClipboardText(report)
          .then(() =>
            toast.success(
              translate('auto.components.agents-workflow.history.copied', 'Error details copied.')
            )
          )
          .catch(() =>
            toast.error(
              translate(
                'auto.components.agents-workflow.history.copyFailed',
                'Could not copy error details.'
              )
            )
          )
      }}
    >
      <Copy />
    </Button>
  )
}

function runErrorReport(run: AgentsWorkflowRun): string {
  return [
    'Agents workflow run failure',
    `Run: ${run.id}`,
    `Workflow: ${run.definitionSnapshot.name} (${run.workflowId}, revision ${run.workflowRevision})`,
    `Trigger: ${run.trigger}`,
    `Status: ${run.status}`,
    ...(run.workspaceId
      ? [`Workspace: ${run.workspaceDisplayName ?? run.workspaceId} (${run.workspaceId})`]
      : []),
    ...(run.errorCode ? [`Error code: ${run.errorCode}`] : []),
    ...(run.errorMessage ? [`Error message: ${run.errorMessage}`] : []),
    ...(run.skipReason ? [`Skip reason: ${run.skipReason}`] : [])
  ].join('\n')
}

function attemptErrorReport(
  run: AgentsWorkflowRun,
  attempt: AgentsWorkflowRun['attempts'][number]
): string {
  return [
    'Agents workflow node failure',
    `Run: ${run.id}`,
    `Workflow: ${run.definitionSnapshot.name} (${run.workflowId}, revision ${run.workflowRevision})`,
    `Status: ${run.status}`,
    ...(run.workspaceId
      ? [`Workspace: ${run.workspaceDisplayName ?? run.workspaceId} (${run.workspaceId})`]
      : []),
    `Node: ${attempt.nodeId}`,
    `Attempt: ${attempt.id} (${attempt.status})`,
    ...(attempt.loopNodeId
      ? [`Loop: ${attempt.loopNodeId} iteration ${attempt.loopIteration ?? 0}`]
      : []),
    ...(attempt.startedAt ? [`Started: ${new Date(attempt.startedAt).toISOString()}`] : []),
    ...(attempt.finishedAt ? [`Finished: ${new Date(attempt.finishedAt).toISOString()}`] : []),
    ...(attempt.errorCode ? [`Error code: ${attempt.errorCode}`] : []),
    ...(attempt.errorMessage ? [`Error message: ${attempt.errorMessage}`] : [])
  ].join('\n')
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
