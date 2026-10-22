import {
  AgentsWorkflowCapabilities,
  AgentsWorkflowCreate,
  AgentsWorkflowCancelRun,
  AgentsWorkflowDelete,
  AgentsWorkflowId,
  AgentsWorkflowList,
  AgentsWorkflowRunNow,
  AgentsWorkflowRuns,
  AgentsWorkflowShowRun,
  AgentsWorkflowUpdate
} from '../../../../shared/rpc-contract/agents-workflow-params'
import { defineMethod } from '../core'

export const AGENTS_WORKFLOW_METHODS = [
  defineMethod({
    name: 'agentsWorkflow.list',
    permission: 'workspace',
    params: AgentsWorkflowList,
    handler: (_params, { runtime }) => ({ workflows: runtime.listAgentsWorkflows() })
  }),
  defineMethod({
    name: 'agentsWorkflow.show',
    permission: 'workspace',
    params: AgentsWorkflowId,
    handler: (params, { runtime }) => ({ workflow: runtime.showAgentsWorkflow(params.id) })
  }),
  defineMethod({
    name: 'agentsWorkflow.capabilities',
    permission: 'workspace',
    params: AgentsWorkflowCapabilities,
    handler: (_params, { runtime }) => ({
      agentChannels: runtime.listAgentsWorkflowAgentChannels()
    })
  }),
  defineMethod({
    name: 'agentsWorkflow.create',
    permission: 'workspace',
    params: AgentsWorkflowCreate,
    handler: async (params, { runtime }) => ({
      workflow: await runtime.createAgentsWorkflow(params.workflow)
    })
  }),
  defineMethod({
    name: 'agentsWorkflow.update',
    permission: 'workspace',
    params: AgentsWorkflowUpdate,
    handler: async (params, { runtime }) => ({
      workflow: await runtime.updateAgentsWorkflow(
        params.id,
        params.expectedRevision,
        params.updates
      )
    })
  }),
  defineMethod({
    name: 'agentsWorkflow.delete',
    permission: 'workspace',
    params: AgentsWorkflowDelete,
    handler: (params, { runtime }) =>
      runtime.deleteAgentsWorkflow(params.id, params.expectedRevision)
  }),
  defineMethod({
    name: 'agentsWorkflow.runNow',
    permission: 'workspace',
    params: AgentsWorkflowRunNow,
    handler: (params, { runtime }) => runtime.runAgentsWorkflowNow(params)
  }),
  defineMethod({
    name: 'agentsWorkflow.cancelRun',
    permission: 'workspace',
    params: AgentsWorkflowCancelRun,
    handler: (params, { runtime }) => runtime.cancelAgentsWorkflowRun(params.runId)
  }),
  defineMethod({
    name: 'agentsWorkflow.runs',
    permission: 'workspace',
    params: AgentsWorkflowRuns,
    handler: (params, { runtime }) => runtime.listAgentsWorkflowRuns(params)
  }),
  defineMethod({
    name: 'agentsWorkflow.showRun',
    permission: 'workspace',
    params: AgentsWorkflowShowRun,
    handler: (params, { runtime }) => runtime.showAgentsWorkflowRun(params.runId)
  })
]
