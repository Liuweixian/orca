import { z } from 'zod'
import { AgentsWorkflowDefinitionSchema } from './agents-workflow-types'

export const AgentsWorkflowRunStatusSchema = z.enum([
  'pending',
  'running',
  'cancel_requested',
  'completed',
  'failed',
  'cancelled',
  'skipped',
  'unverifiable'
])

export const AgentsWorkflowNodeAttemptStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
  'unverifiable'
])

export const AgentsWorkflowNodeOutputSchema = z.strictObject({
  format: z.literal('plain_text'),
  content: z.string(),
  capturedAt: z.number().int(),
  truncated: z.boolean(),
  // `unknown` is a compatibility sink, not a producer value: a newer host may publish a source an
  // older client does not know, and dropping the whole run record is worse than losing the label.
  source: z
    .enum([
      'structured_assistant_message',
      'agent_transcript',
      'agent_file_handoff',
      'terminal_snapshot',
      'unknown'
    ])
    .catch('unknown')
})

export const AgentsWorkflowNodeAttemptSchema = z.strictObject({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  status: AgentsWorkflowNodeAttemptStatusSchema,
  loopNodeId: z.string().min(1).optional(),
  loopIteration: z.number().int().nonnegative().optional(),
  selectedBranch: z.enum(['yes', 'no']).optional(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
  output: AgentsWorkflowNodeOutputSchema.nullable(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().optional()
})

export const AgentsWorkflowRunSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  workflowId: z.string().min(1),
  workflowRevision: z.number().int().positive(),
  definitionSnapshot: AgentsWorkflowDefinitionSchema,
  requestKey: z.string().min(1),
  trigger: z.enum(['manual', 'schedule']),
  scheduledFor: z.number().int().optional(),
  status: AgentsWorkflowRunStatusSchema,
  workspaceId: z.string().min(1).nullable(),
  workspaceDisplayName: z.string().nullable(),
  attempts: z.array(AgentsWorkflowNodeAttemptSchema),
  executionTrace: z.array(z.string().min(1)),
  createdAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().optional(),
  skipReason: z.enum(['active_run', 'missed_grace']).optional()
})

export const AgentsWorkflowRunSummarySchema = AgentsWorkflowRunSchema.omit({
  definitionSnapshot: true,
  attempts: true,
  executionTrace: true
})

/**
 * The idempotency key of one schedule occurrence: one occurrence may only ever produce one run.
 * Shared so the writer, the scheduler and the runtime all name it identically.
 */
export function agentsWorkflowScheduleRequestKey(scheduledFor: number): string {
  return `schedule:${scheduledFor}`
}

export const AgentsWorkflowRunsPageSchema = z.strictObject({
  runs: z.array(AgentsWorkflowRunSummarySchema),
  nextCursor: z.string().nullable()
})

export type AgentsWorkflowRunStatus = z.infer<typeof AgentsWorkflowRunStatusSchema>
export type AgentsWorkflowNodeAttemptStatus = z.infer<typeof AgentsWorkflowNodeAttemptStatusSchema>
export type AgentsWorkflowNodeOutput = z.infer<typeof AgentsWorkflowNodeOutputSchema>
export type AgentsWorkflowNodeAttempt = z.infer<typeof AgentsWorkflowNodeAttemptSchema>
export type AgentsWorkflowRun = z.infer<typeof AgentsWorkflowRunSchema>
export type AgentsWorkflowRunSummary = z.infer<typeof AgentsWorkflowRunSummarySchema>
export type AgentsWorkflowRunsPage = z.infer<typeof AgentsWorkflowRunsPageSchema>
