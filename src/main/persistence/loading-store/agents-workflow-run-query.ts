// Reading and pruning the run history, kept apart from writing it.

import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage,
  AgentsWorkflowRunSummary
} from '../../../shared/agents-workflow-run-types'

export const TERMINAL_RUN_RETENTION_PER_WORKFLOW = 100

export function isActiveAgentsWorkflowRun(run: AgentsWorkflowRun): boolean {
  return run.status === 'pending' || run.status === 'running' || run.status === 'cancel_requested'
}

export function isTerminalAgentsWorkflowRun(run: AgentsWorkflowRun): boolean {
  return (
    run.status === 'completed' ||
    run.status === 'failed' ||
    run.status === 'cancelled' ||
    run.status === 'unverifiable' ||
    run.status === 'skipped'
  )
}

function newestFirst(left: AgentsWorkflowRun, right: AgentsWorkflowRun): number {
  return right.createdAt - left.createdAt || right.id.localeCompare(left.id)
}

/**
 * The page after `cursor`. A cursor whose run was pruned returns an empty page with no next
 * cursor: appending the first page again would duplicate rows in the renderer.
 */
export function pageAgentsWorkflowRuns(
  runs: readonly AgentsWorkflowRun[],
  input: { workflowId?: string; cursor?: string; limit: number }
): AgentsWorkflowRunsPage {
  const sorted = runs
    .filter((run) => input.workflowId === undefined || run.workflowId === input.workflowId)
    .slice()
    .sort(newestFirst)
  let start = 0
  if (input.cursor) {
    const index = sorted.findIndex((run) => run.id === input.cursor)
    if (index === -1) {
      return { runs: [], nextCursor: null }
    }
    start = index + 1
  }
  const page = sorted.slice(start, start + input.limit)
  return {
    runs: page.map(toAgentsWorkflowRunSummary),
    nextCursor: start + input.limit < sorted.length ? (page.at(-1)?.id ?? null) : null
  }
}

/** The runs left after dropping all but the newest `TERMINAL_RUN_RETENTION_PER_WORKFLOW`. */
export function retainTerminalAgentsWorkflowRuns(
  runs: readonly AgentsWorkflowRun[],
  workflowId: string
): AgentsWorkflowRun[] {
  const retainedTerminalIds = new Set(
    runs
      .filter((run) => run.workflowId === workflowId && isTerminalAgentsWorkflowRun(run))
      .slice()
      .sort(newestFirst)
      .slice(0, TERMINAL_RUN_RETENTION_PER_WORKFLOW)
      .map((run) => run.id)
  )
  return runs.filter(
    (run) =>
      run.workflowId !== workflowId ||
      !isTerminalAgentsWorkflowRun(run) ||
      retainedTerminalIds.has(run.id)
  )
}

export function toAgentsWorkflowRunSummary(run: AgentsWorkflowRun): AgentsWorkflowRunSummary {
  const {
    definitionSnapshot: _definitionSnapshot,
    attempts: _attempts,
    executionTrace: _executionTrace,
    ...summary
  } = run
  return summary
}
