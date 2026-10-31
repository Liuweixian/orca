import { z } from 'zod'
import {
  AgentsWorkflowCreateInputSchema,
  AgentsWorkflowUpdateFieldsSchema
} from '../agents-workflow-types'
import { AGENTS_WORKFLOW_GENERATION_REQUEST_LIMIT } from '../agents-workflow-generation'
import type { TuiAgent } from '../tui-agent'
import { isTuiAgent } from '../tui-agent-config'
import { requiredString } from './rpc-param-primitives'

const Revision = z.number().int().positive()
// Why here: an unknown agent is a caller error, not a runtime branch each handler must remember.
const TuiAgentParam = z.custom<TuiAgent>(isTuiAgent, { message: 'Unknown workflow agent' })

export const AgentsWorkflowList = z.object({})

export const AgentsWorkflowCapabilities = z.object({})

export const AgentsWorkflowId = z.object({
  id: requiredString('Missing agent workflow id')
})

export const AgentsWorkflowCreate = z.object({
  workflow: AgentsWorkflowCreateInputSchema
})

export const AgentsWorkflowUpdate = z.object({
  id: requiredString('Missing agent workflow id'),
  expectedRevision: Revision,
  updates: AgentsWorkflowUpdateFieldsSchema
})

export const AgentsWorkflowDelete = z.object({
  id: requiredString('Missing agent workflow id'),
  expectedRevision: Revision
})

export const AgentsWorkflowRunNow = z.object({
  workflowId: requiredString('Missing agent workflow id'),
  // A retry key, not free text: a bounded token keeps an injected value from becoming a huge
  // stored idempotency key or colliding by accident.
  requestKey: requiredString('Missing agent workflow request key').pipe(
    z
      .string()
      .max(200, 'Invalid agent workflow request key')
      .regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid agent workflow request key')
  )
})

export const AgentsWorkflowCancelRun = z.object({
  runId: requiredString('Missing agent workflow run id')
})

export const AgentsWorkflowRuns = z.object({
  workflowId: requiredString('Missing agent workflow id').optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20)
})

export const AgentsWorkflowClearRuns = z.object({
  workflowId: requiredString('Missing agent workflow id')
})

export const AgentsWorkflowShowRun = z.object({
  runId: requiredString('Missing agent workflow run id')
})

export const AgentsWorkflowGenerate = z.object({
  request: requiredString('Missing workflow generation request').pipe(
    z
      .string()
      .trim()
      .min(1, 'Missing workflow generation request')
      .max(AGENTS_WORKFLOW_GENERATION_REQUEST_LIMIT, 'The workflow generation request is too long')
  ),
  // Generation runs the agent in this workspace, so the graph is designed against a real checkout.
  workspaceId: requiredString('Missing workflow generation workspace'),
  agentId: TuiAgentParam,
  // Every agent a generated node may name: the renderer sends what this host can actually run.
  agentIds: z.array(TuiAgentParam).min(1, 'Missing workflow generation agents').max(100)
})
