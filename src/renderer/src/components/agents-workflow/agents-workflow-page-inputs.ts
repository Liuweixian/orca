import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowUpdateFields
} from '../../../../shared/agents-workflow-types'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'

/** The input a new workflow is created from: the current one, or the starter fixture. */
export function newWorkflowInput(
  source: AgentsWorkflowDefinition | null
): AgentsWorkflowCreateInput {
  const template = source ?? createAgentsWorkflowPageFixture()
  const {
    id: _id,
    revision: _revision,
    schedulerOwner: _schedulerOwner,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = template
  return {
    ...input,
    creationKey: createBrowserUuid(),
    name: translate('auto.components.agents-workflow.controller.newName', 'New workflow'),
    trigger: { ...input.trigger, schedule: null }
  }
}

export function workflowUpdateFields(
  definition: AgentsWorkflowDefinition
): AgentsWorkflowUpdateFields {
  return {
    schemaVersion: definition.schemaVersion,
    name: definition.name,
    nodes: definition.nodes,
    edges: definition.edges,
    runContext: definition.runContext,
    workspace: definition.workspace,
    trigger: definition.trigger,
    enabled: definition.enabled
  }
}
