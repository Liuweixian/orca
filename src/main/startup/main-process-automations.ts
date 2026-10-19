import type { AutomationService } from '../automations/service'
import { createRuntimeAutomationService } from '../automations/runtime-automation-service'
import { AgentsWorkflowScheduler } from '../agents-workflow/agents-workflow-scheduler'
import { mainProcessState as state } from './main-process-state'

export function initializeMainProcessAutomations(): AutomationService {
  const store = state.store
  const runtime = state.runtime
  const claudeUsage = state.claudeUsage
  const codexUsage = state.codexUsage
  if (!store || !runtime || !claudeUsage || !codexUsage) {
    throw new Error('Runtime and usage stores must be initialized before automations')
  }
  const service = createRuntimeAutomationService({
    store,
    runtime,
    claudeUsage,
    codexUsage,
    // Why: desktop clients mirror remote-host automations, but only a server process should execute remote_host_service-owned schedules.
    headless: state.isServeMode
  })
  if (!state.isServeMode) {
    bindAgentsWorkflowScheduler(
      service,
      new AgentsWorkflowScheduler({
        listWorkflows: () => store.listAgentsWorkflows(),
        listRuns: (workflowId) => store.listAgentsWorkflowRuns({ workflowId, limit: 100 }).runs,
        runScheduled: (workflow, scheduledFor) =>
          runtime.runScheduledAgentsWorkflow(workflow, scheduledFor),
        recordSkipped: (workflow, scheduledFor, reason) =>
          runtime.recordSkippedAgentsWorkflowOccurrence(workflow, scheduledFor, reason)
      })
    )
  }
  state.automations = service
  return service
}

function bindAgentsWorkflowScheduler(
  automationService: AutomationService,
  workflowScheduler: AgentsWorkflowScheduler
): void {
  const start = automationService.start.bind(automationService)
  const stop = automationService.stop.bind(automationService)
  automationService.start = () => {
    start()
    workflowScheduler.start()
  }
  automationService.stop = () => {
    workflowScheduler.stop()
    stop()
  }
}
