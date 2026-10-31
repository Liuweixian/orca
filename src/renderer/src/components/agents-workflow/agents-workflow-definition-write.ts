import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import { isRevisionConflict, reportDefinitionFailure } from './agents-workflow-definition-errors'
import { workflowUpdateFields } from './agents-workflow-page-inputs'
import { updateAgentsWorkflow } from './agents-workflow-rpc-client'

/**
 * Writes `next` over the saved workflow and reports the outcome. Always resolves: a lost revision
 * race and a rejected graph are both states the page must show, not errors that unwind a caller.
 */
export async function writeSavedAgentsWorkflow(input: {
  saved: AgentsWorkflowDefinition
  next: AgentsWorkflowDefinition
  /** Hands over the host's copy, which is now both the saved and the on-screen definition. */
  applySaved: (definition: AgentsWorkflowDefinition) => void
  onConflict: () => void
}): Promise<void> {
  try {
    const saved = await updateAgentsWorkflow(
      input.saved.id,
      input.saved.revision,
      workflowUpdateFields(input.next)
    )
    input.applySaved(saved)
    toast.success(translate('auto.components.agents-workflow.controller.saved', 'Workflow saved.'))
  } catch (error) {
    if (isRevisionConflict(error)) {
      input.onConflict()
      return
    }
    reportDefinitionFailure(
      error,
      translate(
        'auto.components.agents-workflow.controller.saveFailed',
        'Could not save the workflow.'
      )
    )
  }
}
