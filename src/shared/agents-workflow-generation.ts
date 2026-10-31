// Turning one user request into a workflow graph: the contract, the layout, and the prompt.
//
// The agent answers with a graph, not pixels. Positions are assigned here so a generation can
// never produce overlapping cards and the model never has to reason about canvas coordinates.

import { z } from 'zod'
import { LOCAL_EXECUTION_HOST_ID } from './execution-host'
import type { TuiAgent } from './tui-agent'
import { validateParsedAgentsWorkflowDefinition } from './agents-workflow-graph-validation'
import type { AgentsWorkflowValidationIssue } from './agents-workflow-graph'
import {
  AgentsWorkflowEdgeSchema,
  AgentsWorkflowNodeSchema,
  type AgentsWorkflowDefinition,
  type AgentsWorkflowEdge,
  type AgentsWorkflowNode
} from './agents-workflow-types'

export const AGENTS_WORKFLOW_GENERATION_REQUEST_LIMIT = 4000

export const AgentsWorkflowGenerationDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nodes: z.array(AgentsWorkflowNodeSchema).min(2).max(24),
  edges: z.array(AgentsWorkflowEdgeSchema).max(48)
})

export type AgentsWorkflowGenerationDraft = z.infer<typeof AgentsWorkflowGenerationDraftSchema>

type AgentsWorkflowGenerationParse =
  | { ok: true; draft: AgentsWorkflowGenerationDraft }
  | { ok: false; issues: AgentsWorkflowValidationIssue[] }

const NODE_KEYS = ['id', 'kind', 'title', 'agentId', 'prompt', 'command', 'count']
const EDGE_KEYS = ['id', 'fromNodeId', 'toNodeId', 'fromPort', 'toPort']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function project(value: unknown, keys: readonly string[]): unknown {
  if (!isRecord(value)) {
    return value
  }
  const projected: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in value) {
      projected[key] = value[key]
    }
  }
  return projected
}

/**
 * Agents routinely add fields the schema forbids and always omit positions; both are fixable here.
 * Position is dropped rather than tolerated: the layout below overwrites it, so a malformed one
 * would only cost a repair turn.
 */
function normalizeNode(value: unknown): unknown {
  const projected = project(value, NODE_KEYS)
  if (!isRecord(projected)) {
    return projected
  }
  const prompt = projected.prompt
  return {
    position: { x: 0, y: 0 },
    ...projected,
    ...(typeof prompt === 'string'
      ? { prompt: { source: prompt } }
      : isRecord(prompt)
        ? { prompt: project(prompt, ['source']) }
        : {})
  }
}

function normalizeEdge(value: unknown, index: number): unknown {
  const projected = project(value, EDGE_KEYS)
  if (!isRecord(projected)) {
    return projected
  }
  return {
    ...projected,
    ...(projected.id === undefined ? { id: `edge-${index + 1}` } : {}),
    ...(projected.toPort === undefined ? { toPort: 'default' } : {})
  }
}

function normalizeGraph(value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  return {
    ...value,
    ...(Array.isArray(value.nodes) ? { nodes: value.nodes.map(normalizeNode) } : {}),
    ...(Array.isArray(value.edges)
      ? { edges: value.edges.map((edge, index) => normalizeEdge(edge, index)) }
      : {})
  }
}

/** The whole reply, then a fenced block, then the outer brace span: agents wrap JSON in prose. */
function* jsonCandidates(source: string): Generator<string> {
  const trimmed = source.trim()
  yield trimmed
  for (const match of trimmed.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)) {
    yield (match[1] ?? '').trim()
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start && !(start === 0 && end === trimmed.length - 1)) {
    yield trimmed.slice(start, end + 1)
  }
}

const LAYOUT_COLUMN_WIDTH = 280
const LAYOUT_ROW_HEIGHT = 150
const LAYOUT_ORIGIN_X = 80
const LAYOUT_ORIGIN_Y = 80

/**
 * Places nodes by distance from start. Why a plain BFS: the aggregate edge makes every loop body
 * cyclic, so a longest-path layering would need cycle detection just to decide a column.
 */
export function layoutAgentsWorkflowGenerationNodes(
  nodes: readonly AgentsWorkflowNode[],
  edges: readonly AgentsWorkflowEdge[]
): AgentsWorkflowNode[] {
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.toPort === 'aggregate') {
      continue
    }
    const targets = outgoing.get(edge.fromNodeId) ?? []
    targets.push(edge.toNodeId)
    outgoing.set(edge.fromNodeId, targets)
  }
  const depth = new Map<string, number>()
  const start = nodes.find((node) => node.kind === 'start')
  const queue: string[] = start ? [start.id] : []
  if (start) {
    depth.set(start.id, 0)
  }
  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (nodeId === undefined) {
      break
    }
    const nextDepth = (depth.get(nodeId) ?? 0) + 1
    for (const target of outgoing.get(nodeId) ?? []) {
      if (depth.has(target)) {
        continue
      }
      depth.set(target, nextDepth)
      queue.push(target)
    }
  }
  let fallbackColumn = 0
  for (const value of depth.values()) {
    fallbackColumn = Math.max(fallbackColumn, value + 1)
  }
  const rows = new Map<number, number>()
  return nodes.map((node) => {
    const column = depth.get(node.id) ?? fallbackColumn
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    return {
      ...node,
      position: {
        x: LAYOUT_ORIGIN_X + column * LAYOUT_COLUMN_WIDTH,
        y: LAYOUT_ORIGIN_Y + row * LAYOUT_ROW_HEIGHT
      }
    }
  })
}

/** The graph rules only depend on the graph, so a placeholder target is enough to check them. */
function agentsWorkflowGenerationIssues(
  draft: AgentsWorkflowGenerationDraft
): AgentsWorkflowValidationIssue[] {
  const placeholder: AgentsWorkflowDefinition = {
    schemaVersion: 1,
    id: 'generation-draft',
    revision: 1,
    name: draft.name,
    nodes: draft.nodes,
    edges: draft.edges,
    runContext: {
      kind: 'workspace-run',
      projectId: 'generation-project',
      hostId: LOCAL_EXECUTION_HOST_ID,
      projectHostSetupId: 'generation-setup',
      repoId: 'generation-repo',
      path: '/'
    },
    workspace: { mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' },
    trigger: { manual: true, schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 0,
    updatedAt: 0
  }
  return validateParsedAgentsWorkflowDefinition(placeholder)
}

/**
 * The prompt names the agents this host can run, so a graph naming any other one is unrunnable
 * here even though the schema accepts it. Checked here, not only promised in the prompt.
 */
function agentAvailabilityIssues(
  nodes: readonly AgentsWorkflowNode[],
  agentIds: readonly TuiAgent[]
): AgentsWorkflowValidationIssue[] {
  const allowed = new Set<string>(agentIds)
  const issues: AgentsWorkflowValidationIssue[] = []
  for (const node of nodes) {
    if (node.kind !== 'agent' && node.kind !== 'condition') {
      continue
    }
    if (allowed.has(node.agentId)) {
      continue
    }
    issues.push({
      severity: 'error',
      code: 'agent_not_available',
      message: `Node ${node.id} uses agent ${node.agentId}, which this host cannot run. Use one of: ${[...allowed].join(', ')}.`,
      nodeId: node.id
    })
  }
  return issues
}

export function parseAgentsWorkflowGenerationDraft(
  source: string,
  agentIds: readonly TuiAgent[]
): AgentsWorkflowGenerationParse {
  for (const candidate of jsonCandidates(source)) {
    let raw: unknown
    try {
      raw = JSON.parse(candidate)
    } catch {
      continue
    }
    const parsed = AgentsWorkflowGenerationDraftSchema.safeParse(normalizeGraph(raw))
    if (!parsed.success) {
      continue
    }
    const nodes = layoutAgentsWorkflowGenerationNodes(parsed.data.nodes, parsed.data.edges)
    const draft = { ...parsed.data, nodes }
    const issues = [
      ...agentsWorkflowGenerationIssues(draft),
      ...agentAvailabilityIssues(nodes, agentIds)
    ]
    if (issues.some((issue) => issue.severity === 'error')) {
      return { ok: false, issues }
    }
    return { ok: true, draft }
  }
  return { ok: false, issues: [] }
}

const NODE_SHAPES = `- {"id":"start","kind":"start","title":"Start"}
- {"id":"end","kind":"end","title":"End"}
- {"id":"a1","kind":"agent","title":"<short title>","agentId":"<agent id>","prompt":{"source":"<full instruction for the agent>"}}
- {"id":"c1","kind":"condition","title":"<short title>","agentId":"<agent id>","prompt":{"source":"<judging instruction>"}}
- {"id":"cmd1","kind":"command","title":"<short title>","command":"<shell command>"}
- {"id":"loop1","kind":"loop","title":"<short title>","count":<2-20>}`

function promptHeader(input: { agentIds: readonly string[]; defaultAgentId: string }): string {
  return `You design Orca agent workflows.

A workflow is a directed graph of nodes that run in order. Reply with one JSON object and nothing else: no prose, no fences.

{"name":"<short workflow name>","nodes":[...],"edges":[...]}

Node shapes (these are the only fields each node may have):
${NODE_SHAPES}

Edge shape (these are the only fields an edge may have):
- {"id":"e1","fromNodeId":"a1","toNodeId":"a2","fromPort":"default","toPort":"default"}

Ports:
- start, agent and command have one outgoing port: "default".
- condition has exactly two outgoing edges, one with fromPort "yes" and one with fromPort "no".
- loop has exactly one outgoing edge with fromPort "each" (the body entry) and one with fromPort "done" (the exit). The body's last node returns to the loop through an edge with toPort "aggregate".
- Every other edge uses toPort "default".

Rules the graph must satisfy:
1. Exactly one start node and exactly one end node.
2. Every node is reachable from start, and every node can reach end. End has no outgoing edge.
3. No cycles, except a loop body returning to its loop through the aggregate edge.
4. A condition prompt must ask for exactly one JSON object: {"decision":"yes"} or {"decision":"no"}.
5. Every agent and condition prompt is a complete instruction that stands alone; the node reads the previous node's answer from the upstream note prepended to it.
6. A loop body may not contain another loop, and nothing outside the loop may enter its body.
7. Use only these agent ids: ${input.agentIds.join(', ')}. Prefer "${input.defaultAgentId}" unless a node clearly needs another one.
8. Node and edge ids are unique lowercase slugs. Titles are short and human readable.
9. Prefer a small graph of 3-8 nodes. Add a loop only when the request asks for repetition.
10. This workspace is the user's real checkout: read what you need and change no file. If this task ends by naming an output file for your answer, write only that file.`
}

export function buildAgentsWorkflowGenerationPrompt(input: {
  request: string
  agentIds: readonly string[]
  defaultAgentId: string
  repair?: { issues: readonly AgentsWorkflowValidationIssue[]; previous: string }
}): string {
  const header = promptHeader(input)
  const request = `User request:
"""
${input.request}
"""`

  if (!input.repair) {
    return `${header}\n\n${request}`
  }
  const issues =
    input.repair.issues.length > 0
      ? input.repair.issues.map((issue) => `- ${issue.code}: ${issue.message}`).join('\n')
      : '- The answer was not a valid workflow JSON object.'
  return `${header}

Your previous answer could not be run as a workflow.

Problems found:
${issues}

Previous answer:
"""
${input.repair.previous}
"""

${request}

Reply again with the corrected JSON object only.`
}
