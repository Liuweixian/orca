import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowUpdateFields
} from '../../../../shared/agents-workflow-types'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage
} from '../../../../shared/agents-workflow-run-types'
import type { AgentsWorkflowAgentChannelEntry } from '../../../../shared/agents-workflow-agent-channels'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

const LOCAL_TARGET = { kind: 'local' } as const

export type AgentsWorkflowAgentChannelView = AgentsWorkflowAgentChannelEntry

export async function listAgentsWorkflowAgentChannels(): Promise<AgentsWorkflowAgentChannelView[]> {
  const result = await callRuntimeRpc<{
    agentChannels: AgentsWorkflowAgentChannelEntry[]
  }>(LOCAL_TARGET, 'agentsWorkflow.capabilities', {})
  return result.agentChannels
}

export async function listAgentsWorkflows(): Promise<AgentsWorkflowDefinition[]> {
  const result = await callRuntimeRpc<{ workflows: AgentsWorkflowDefinition[] }>(
    LOCAL_TARGET,
    'agentsWorkflow.list',
    {}
  )
  return result.workflows
}

export async function showAgentsWorkflow(id: string): Promise<AgentsWorkflowDefinition> {
  const result = await callRuntimeRpc<{ workflow: AgentsWorkflowDefinition }>(
    LOCAL_TARGET,
    'agentsWorkflow.show',
    { id }
  )
  return result.workflow
}

export async function createAgentsWorkflow(
  workflow: AgentsWorkflowCreateInput
): Promise<AgentsWorkflowDefinition> {
  const result = await callRuntimeRpc<{ workflow: AgentsWorkflowDefinition }>(
    LOCAL_TARGET,
    'agentsWorkflow.create',
    { workflow }
  )
  return result.workflow
}

export async function updateAgentsWorkflow(
  id: string,
  expectedRevision: number,
  updates: AgentsWorkflowUpdateFields
): Promise<AgentsWorkflowDefinition> {
  const result = await callRuntimeRpc<{ workflow: AgentsWorkflowDefinition }>(
    LOCAL_TARGET,
    'agentsWorkflow.update',
    { id, expectedRevision, updates }
  )
  return result.workflow
}

export async function deleteAgentsWorkflow(id: string, expectedRevision: number): Promise<void> {
  await callRuntimeRpc(LOCAL_TARGET, 'agentsWorkflow.delete', { id, expectedRevision })
}

/** Drops this workflow's finished runs; the host keeps any run that is still active. */
export async function clearAgentsWorkflowRuns(workflowId: string): Promise<number> {
  const result = await callRuntimeRpc<{ removed: number }>(
    LOCAL_TARGET,
    'agentsWorkflow.clearRuns',
    { workflowId }
  )
  return result.removed
}

export function runAgentsWorkflow(
  workflowId: string,
  requestKey: string
): Promise<AgentsWorkflowRun> {
  return callRuntimeRpc(LOCAL_TARGET, 'agentsWorkflow.runNow', { workflowId, requestKey })
}

export function cancelAgentsWorkflowRun(runId: string): Promise<AgentsWorkflowRun> {
  return callRuntimeRpc(LOCAL_TARGET, 'agentsWorkflow.cancelRun', { runId })
}

export function listAgentsWorkflowRuns(input: {
  workflowId: string
  cursor?: string
  limit: number
}): Promise<AgentsWorkflowRunsPage> {
  return callRuntimeRpc(LOCAL_TARGET, 'agentsWorkflow.runs', input)
}

export function showAgentsWorkflowRun(runId: string): Promise<AgentsWorkflowRun> {
  return callRuntimeRpc(LOCAL_TARGET, 'agentsWorkflow.showRun', { runId })
}
