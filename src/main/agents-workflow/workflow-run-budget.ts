/**
 * The ceiling for one whole run. A single node may wait 30 minutes for its answer file, so a
 * 20-turn loop could otherwise occupy a workspace for ten hours with nobody watching the spend.
 */
export const AGENTS_WORKFLOW_RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000

export type AgentsWorkflowRunBudget = {
  /** True once the abort fired because the budget ran out, not because the user cancelled. */
  exceeded: boolean
  clear: () => void
}

/**
 * Aborts the run when its total budget runs out. Why a separate timer from the run's cancel
 * controller: cancellation is the user's intent and must record `cancelled`, while an expired
 * budget is a failure the user did not ask for.
 */
export function startAgentsWorkflowRunBudget(
  controller: AbortController,
  timeoutMs: number = AGENTS_WORKFLOW_RUN_TIMEOUT_MS
): AgentsWorkflowRunBudget {
  const budget: AgentsWorkflowRunBudget = { exceeded: false, clear: () => undefined }
  const timer = setTimeout(() => {
    budget.exceeded = true
    controller.abort()
  }, timeoutMs)
  budget.clear = () => clearTimeout(timer)
  return budget
}
