import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { AGENTS_WORKFLOW_RUN_CONFLICT } from '../../../../shared/agents-workflow-errors'
import type { AgentsWorkflowRun } from '../../../../shared/agents-workflow-run-types'
import { runAgentsWorkflow } from './agents-workflow-rpc-client'

/**
 * Starts a run and reports a failure once, so the workflow page and the sidebar cannot drift.
 * Returns null when the run could not be started.
 */
export async function runAgentsWorkflowWithToast(
  workflowId: string
): Promise<AgentsWorkflowRun | null> {
  try {
    return await runAgentsWorkflow(workflowId, createBrowserUuid())
  } catch (error) {
    toast.error(
      error instanceof RuntimeRpcCallError && error.code === AGENTS_WORKFLOW_RUN_CONFLICT
        ? translate(
            'auto.components.agents-workflow.controller.runConflict',
            'This workflow or its workspace already has an active run. Wait for it to finish.'
          )
        : translate(
            'auto.components.agents-workflow.controller.runFailed',
            'Could not start the workflow.'
          )
    )
    return null
  }
}
