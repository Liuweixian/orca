// Writing workflow definitions: create, revise, delete — and the guard every write passes.

import { randomUUID } from 'node:crypto'
import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowUpdateFields
} from '../../../shared/agents-workflow-types'
import {
  AgentsWorkflowDefinitionInvalidError,
  AgentsWorkflowRevisionConflictError
} from '../../../shared/agents-workflow-errors'
import { agentsWorkflowDefinitionErrors } from '../../../shared/agents-workflow-definition-check'

/** The slice of profile state a definition write touches. */
export type AgentsWorkflowDefinitionStore = {
  find(id: string): AgentsWorkflowDefinition | undefined
  all(): AgentsWorkflowDefinition[]
  replace(next: AgentsWorkflowDefinition[]): void
  flush(): void
}

export function createAgentsWorkflowDefinition(
  store: AgentsWorkflowDefinitionStore,
  input: AgentsWorkflowCreateInput
): AgentsWorkflowDefinition {
  if (input.creationKey) {
    const existing = store.all().find((entry) => entry.creationKey === input.creationKey)
    if (existing) {
      return existing
    }
  }
  const now = Date.now()
  const workflow: AgentsWorkflowDefinition = {
    ...input,
    id: randomUUID(),
    revision: 1,
    schedulerOwner: 'local_host_service',
    createdAt: now,
    updatedAt: now
  }
  assertDefinitionIsRunnable(workflow)
  store.replace([...store.all(), workflow])
  store.flush()
  return workflow
}

export function updateAgentsWorkflowDefinition(
  store: AgentsWorkflowDefinitionStore,
  id: string,
  expectedRevision: number,
  updates: AgentsWorkflowUpdateFields
): AgentsWorkflowDefinition {
  const current = requireDefinition(store, id)
  assertRevision(current, expectedRevision)
  const definedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  )
  const updated: AgentsWorkflowDefinition = {
    ...current,
    ...definedUpdates,
    id: current.id,
    revision: current.revision + 1,
    creationKey: current.creationKey,
    schedulerOwner: 'local_host_service',
    createdAt: current.createdAt,
    updatedAt: Date.now()
  }
  assertDefinitionIsRunnable(updated)
  store.replace(store.all().map((entry) => (entry.id === id ? updated : entry)))
  store.flush()
  return updated
}

/**
 * Removes the definition. Why its runs and checkouts are left alone: a manual run's checkout is
 * the user's workspace, and run history survives until retention prunes it.
 */
export function deleteAgentsWorkflowDefinition(
  store: AgentsWorkflowDefinitionStore,
  id: string,
  expectedRevision: number
): boolean {
  assertRevision(requireDefinition(store, id), expectedRevision)
  store.replace(store.all().filter((entry) => entry.id !== id))
  store.flush()
  return true
}

function requireDefinition(
  store: AgentsWorkflowDefinitionStore,
  id: string
): AgentsWorkflowDefinition {
  const workflow = store.find(id)
  if (!workflow) {
    throw new Error('Agent workflow not found.')
  }
  return workflow
}

/**
 * Why refuse the write instead of storing it: a definition that reaches the store but cannot be
 * compiled fails on every scheduled occurrence with no one watching.
 */
function assertDefinitionIsRunnable(definition: AgentsWorkflowDefinition): void {
  const errors = agentsWorkflowDefinitionErrors(definition)
  if (errors.length > 0) {
    throw new AgentsWorkflowDefinitionInvalidError(errors)
  }
}

function assertRevision(workflow: AgentsWorkflowDefinition, expectedRevision: number): void {
  if (workflow.revision !== expectedRevision) {
    throw new AgentsWorkflowRevisionConflictError(expectedRevision, workflow.revision)
  }
}
