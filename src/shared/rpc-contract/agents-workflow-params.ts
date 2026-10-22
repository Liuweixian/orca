import { z } from 'zod'
import {
  AgentsWorkflowCreateInputSchema,
  AgentsWorkflowUpdateFieldsSchema
} from '../agents-workflow-types'
import { requiredString } from './rpc-param-primitives'

const Revision = z.number().int().positive()

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
