import { AgentsWorkflowScheduler } from '../agents-workflow/agents-workflow-scheduler'
import { agentsWorkflowScheduleRequestKey } from '../../shared/agents-workflow-run-types'
import { mainProcessState as state } from './main-process-state'

export function initializeMainProcessAgentsWorkflow(): void {
  const store = state.store
  const runtime = state.runtime
  if (!store || !runtime) {
    throw new Error('Runtime and store must be initialized before agent workflows')
  }
  // Why: a scheduled occurrence is claimed by exactly one process; a headless serve host must not
  // race the desktop client for the same run row.
  if (state.isServeMode) {
    return
  }
  state.agentsWorkflowScheduler = new AgentsWorkflowScheduler({
    listWorkflows: () => store.listAgentsWorkflows(),
    // Why the exact key: scanning the newest runs missed an occurrence whose run had already
    // been pruned, and the run retention limit (100) silently decided how far the scan reached.
    hasScheduledRun: (workflowId, scheduledFor) =>
      store.findAgentsWorkflowRunByRequestKey(
        workflowId,
        agentsWorkflowScheduleRequestKey(scheduledFor)
      ) !== null,
    runScheduled: (workflow, scheduledFor) =>
      runtime.runScheduledAgentsWorkflow(workflow, scheduledFor),
    recordSkipped: (workflow, scheduledFor, reason) =>
      runtime.recordSkippedAgentsWorkflowOccurrence(workflow, scheduledFor, reason)
  })
}
