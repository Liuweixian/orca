import { z } from 'zod'
import type { TuiAgent } from './tui-agent'
import { isTuiAgent } from './tui-agent-config'

const NonEmptyId = z.string().trim().min(1)
const Position = z.strictObject({ x: z.number().finite(), y: z.number().finite() })
const TuiAgentSchema = z.custom<TuiAgent>(isTuiAgent)

export const AgentsWorkflowPromptSchema = z.strictObject({
  source: z.string()
})

const StartNodeSchema = z.strictObject({
  id: NonEmptyId,
  kind: z.literal('start'),
  title: z.string(),
  position: Position
})

const AgentNodeSchema = z.strictObject({
  id: NonEmptyId,
  kind: z.literal('agent'),
  title: z.string(),
  position: Position,
  agentId: TuiAgentSchema,
  prompt: AgentsWorkflowPromptSchema,
  extraAgentArgs: z.string().optional(),
  terminal: z.boolean()
})

/** A condition asks an agent to answer yes or no, so it carries its own agent turn. */
const ConditionNodeSchema = z.strictObject({
  id: NonEmptyId,
  kind: z.literal('condition'),
  title: z.string(),
  position: Position,
  agentId: TuiAgentSchema,
  prompt: AgentsWorkflowPromptSchema,
  extraAgentArgs: z.string().optional()
})

const LoopNodeSchema = z.strictObject({
  id: NonEmptyId,
  kind: z.literal('loop'),
  title: z.string(),
  position: Position,
  count: z.number().int().min(1).max(20)
})

export const AgentsWorkflowNodeSchema = z.discriminatedUnion('kind', [
  StartNodeSchema,
  AgentNodeSchema,
  ConditionNodeSchema,
  LoopNodeSchema
])

export const AgentsWorkflowEdgeSchema = z.strictObject({
  id: NonEmptyId,
  fromNodeId: NonEmptyId,
  toNodeId: NonEmptyId,
  fromPort: z.enum(['default', 'yes', 'no', 'each', 'done']),
  toPort: z.enum(['default', 'aggregate'])
})

export const AgentsWorkflowRunContextSchema = z.strictObject({
  kind: z.literal('workspace-run'),
  projectId: NonEmptyId,
  hostId: NonEmptyId,
  projectHostSetupId: NonEmptyId,
  repoId: NonEmptyId,
  path: z.string().min(1)
})

export const AgentsWorkflowWorkspaceSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('new_per_run'),
    baseBranch: z.string().nullable(),
    setupDecision: z.enum(['inherit', 'run', 'skip'])
  }),
  z.strictObject({ mode: z.literal('existing'), workspaceId: NonEmptyId })
])

export const AgentsWorkflowScheduleSchema = z.strictObject({
  timezone: NonEmptyId,
  rrule: NonEmptyId,
  dtstart: z.number().int(),
  missedRunGraceMinutes: z.number().int().nonnegative()
})

export const AgentsWorkflowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: NonEmptyId,
  revision: z.number().int().positive(),
  creationKey: NonEmptyId.optional(),
  name: z.string(),
  nodes: z.array(AgentsWorkflowNodeSchema),
  edges: z.array(AgentsWorkflowEdgeSchema),
  runContext: AgentsWorkflowRunContextSchema,
  workspace: AgentsWorkflowWorkspaceSchema,
  trigger: z.strictObject({
    manual: z.literal(true),
    schedule: AgentsWorkflowScheduleSchema.nullable()
  }),
  schedulerOwner: z.literal('local_host_service'),
  enabled: z.boolean(),
  createdAt: z.number().int(),
  updatedAt: z.number().int()
})

export type AgentsWorkflowPrompt = z.infer<typeof AgentsWorkflowPromptSchema>
export type AgentsWorkflowNode = z.infer<typeof AgentsWorkflowNodeSchema>
export type AgentsWorkflowEdge = z.infer<typeof AgentsWorkflowEdgeSchema>
export type AgentsWorkflowRunContext = z.infer<typeof AgentsWorkflowRunContextSchema>
export type AgentsWorkflowWorkspace = z.infer<typeof AgentsWorkflowWorkspaceSchema>
export type AgentsWorkflowSchedule = z.infer<typeof AgentsWorkflowScheduleSchema>
export type AgentsWorkflowDefinition = z.infer<typeof AgentsWorkflowDefinitionSchema>

export const AgentsWorkflowCreateInputSchema = AgentsWorkflowDefinitionSchema.omit({
  id: true,
  revision: true,
  schedulerOwner: true,
  createdAt: true,
  updatedAt: true
})

export const AgentsWorkflowUpdateFieldsSchema = AgentsWorkflowCreateInputSchema.omit({
  creationKey: true
}).partial()

export type AgentsWorkflowCreateInput = z.infer<typeof AgentsWorkflowCreateInputSchema>
export type AgentsWorkflowUpdateFields = z.infer<typeof AgentsWorkflowUpdateFieldsSchema>
