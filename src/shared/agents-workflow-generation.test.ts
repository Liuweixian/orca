import { describe, expect, it } from 'vitest'
import {
  buildAgentsWorkflowGenerationPrompt,
  layoutAgentsWorkflowGenerationNodes,
  parseAgentsWorkflowGenerationDraft
} from './agents-workflow-generation'
import type { AgentsWorkflowEdge, AgentsWorkflowNode } from './agents-workflow-types'

const linearGraph = {
  name: 'Review changes',
  nodes: [
    { id: 'start', kind: 'start', title: 'Start' },
    {
      id: 'review',
      kind: 'agent',
      title: 'Review',
      agentId: 'claude',
      prompt: 'Review every changed file. Answer with a short list.'
    },
    {
      id: 'verify',
      kind: 'command',
      title: 'Verify',
      command: 'pnpm test'
    },
    { id: 'end', kind: 'end', title: 'End' }
  ],
  edges: [
    { id: 'e1', fromNodeId: 'start', toNodeId: 'review', fromPort: 'default', toPort: 'default' },
    { id: 'e2', fromNodeId: 'review', toNodeId: 'verify', fromPort: 'default', toPort: 'default' },
    { id: 'e3', fromNodeId: 'verify', toNodeId: 'end', fromPort: 'default', toPort: 'default' }
  ]
}

describe('parseAgentsWorkflowGenerationDraft', () => {
  it('reads a fenced graph and lays it out left to right', () => {
    const parsed = parseAgentsWorkflowGenerationDraft(
      `Here is the workflow:\n\`\`\`json\n${JSON.stringify(linearGraph)}\n\`\`\``,
      ['claude']
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.draft.name).toBe('Review changes')
    const byId = new Map(parsed.draft.nodes.map((node) => [node.id, node.position]))
    expect(byId.get('start')).toEqual({ x: 80, y: 80 })
    expect(byId.get('review')?.x).toBeGreaterThan(80)
    expect(byId.get('end')?.x).toBeGreaterThan(byId.get('verify')?.x ?? 0)
  })

  it('fills what an agent commonly omits: positions, edge ids and string prompts', () => {
    const parsed = parseAgentsWorkflowGenerationDraft(
      JSON.stringify({
        name: 'Review changes',
        nodes: [
          { id: 'start', kind: 'start', title: 'Start' },
          {
            id: 'review',
            kind: 'agent',
            title: 'Review',
            agentId: 'claude',
            prompt: 'Review every changed file. Answer with a short list.'
          },
          { id: 'verify', kind: 'command', title: 'Verify', command: 'pnpm test' },
          { id: 'end', kind: 'end', title: 'End' }
        ],
        edges: [
          { fromNodeId: 'start', toNodeId: 'review', fromPort: 'default' },
          { fromNodeId: 'review', toNodeId: 'verify', fromPort: 'default' },
          { fromNodeId: 'verify', toNodeId: 'end', fromPort: 'default' }
        ]
      }),
      ['claude']
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) {
      return
    }
    expect(parsed.draft.edges.map((edge) => edge.id)).toEqual(['edge-1', 'edge-2', 'edge-3'])
    expect(parsed.draft.nodes.every((node) => node.position.y === 80)).toBe(true)
    expect(parsed.draft.nodes.find((node) => node.id === 'review')).toMatchObject({
      prompt: { source: 'Review every changed file. Answer with a short list.' }
    })
  })

  it('reports the graph rules a draft breaks', () => {
    const parsed = parseAgentsWorkflowGenerationDraft(
      JSON.stringify({
        ...linearGraph,
        edges: linearGraph.edges.filter((edge) => edge.id !== 'e3')
      }),
      ['claude']
    )

    expect(parsed.ok).toBe(false)
    if (parsed.ok) {
      return
    }
    expect(parsed.issues.map((issue) => issue.code)).toContain('node_not_reaching_end')
  })

  // Why: the prompt can only ask; a graph naming an agent this host cannot run must fail here.
  it('rejects a node whose agent this host cannot run', () => {
    const parsed = parseAgentsWorkflowGenerationDraft(JSON.stringify(linearGraph), ['codex'])

    expect(parsed.ok).toBe(false)
    if (parsed.ok) {
      return
    }
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'agent_not_available', nodeId: 'review' })
    )
  })
})

describe('layoutAgentsWorkflowGenerationNodes', () => {
  it('keeps a loop body in its own column and rows apart', () => {
    const nodes: AgentsWorkflowNode[] = [
      { id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } },
      { id: 'loop', kind: 'loop', title: 'Loop', position: { x: 0, y: 0 }, count: 3 },
      { id: 'body', kind: 'command', title: 'Body', position: { x: 0, y: 0 }, command: 'ls' },
      { id: 'end', kind: 'end', title: 'End', position: { x: 0, y: 0 } }
    ]
    const edges: AgentsWorkflowEdge[] = [
      { id: 'e1', fromNodeId: 'start', toNodeId: 'loop', fromPort: 'default', toPort: 'default' },
      { id: 'e2', fromNodeId: 'loop', toNodeId: 'body', fromPort: 'each', toPort: 'default' },
      { id: 'e3', fromNodeId: 'body', toNodeId: 'loop', fromPort: 'default', toPort: 'aggregate' },
      { id: 'e4', fromNodeId: 'loop', toNodeId: 'end', fromPort: 'done', toPort: 'default' }
    ]

    const positioned = layoutAgentsWorkflowGenerationNodes(nodes, edges)
    const byId = new Map(positioned.map((node) => [node.id, node.position]))

    expect(byId.get('loop')?.x).toBeGreaterThan(byId.get('start')?.x ?? 0)
    expect(byId.get('body')?.x).toBeGreaterThan(byId.get('loop')?.x ?? 0)
    expect(byId.get('end')?.x).toBeGreaterThan(byId.get('loop')?.x ?? 0)
    expect(byId.get('body')?.y).not.toBe(byId.get('end')?.y)
  })
})

describe('buildAgentsWorkflowGenerationPrompt', () => {
  it('names the only agents a node may use and the graph rules', () => {
    const prompt = buildAgentsWorkflowGenerationPrompt({
      request: 'Review my changes',
      agentIds: ['claude', 'codex'],
      defaultAgentId: 'claude'
    })

    expect(prompt).toContain('claude, codex')
    expect(prompt).toContain('Review my changes')
    expect(prompt).toContain('Exactly one start node')
  })

  it('hands the repair turn the problems and the previous answer', () => {
    const prompt = buildAgentsWorkflowGenerationPrompt({
      request: 'Review my changes',
      agentIds: ['claude'],
      defaultAgentId: 'claude',
      repair: {
        issues: [{ severity: 'error', code: 'end_count', message: 'Add exactly one end node.' }],
        previous: '{"name":"nope"}'
      }
    })

    expect(prompt).toContain('end_count: Add exactly one end node.')
    expect(prompt).toContain('{"name":"nope"}')
  })
})
