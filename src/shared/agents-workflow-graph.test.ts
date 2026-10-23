import { describe, expect, it } from 'vitest'
import { compileWorkflowGraph, validateWorkflowDefinition } from './agents-workflow-graph'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from './agents-workflow-types'

type AgentNode = Extract<AgentsWorkflowNode, { kind: 'agent' }>

function node(id: string, overrides: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    kind: 'agent',
    title: id,
    position: { x: 0, y: 0 },
    agentId: 'claude',
    prompt: { source: `${id} prompt` },
    ...overrides
  }
}

function edge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  overrides: Partial<AgentsWorkflowEdge> = {}
): AgentsWorkflowEdge {
  return {
    id,
    fromNodeId,
    toNodeId,
    fromPort: 'default',
    toPort: 'default',
    ...overrides
  }
}

function definition(
  nodes: AgentsWorkflowNode[],
  edges: AgentsWorkflowEdge[]
): AgentsWorkflowDefinition {
  const withEnd = nodes.some((node) => node.kind === 'end') ? nodes : [...nodes, end()]
  const withOutgoing = new Set(edges.map((entry) => entry.fromNodeId))
  // Why wire sinks automatically: every graph must reach its end node, and these fixtures focus on
  // the rule under test instead of repeating a boundary edge. Conditions and loops are left alone:
  // their named branches belong to the fixture, and `default` is not a valid port for them.
  const boundaryEdges = withEnd
    .filter(
      (node) =>
        (node.kind === 'start' || node.kind === 'agent' || node.kind === 'command') &&
        !withOutgoing.has(node.id)
    )
    .map((node) => edge(`to-end-${node.id}`, node.id, 'end'))
  return {
    schemaVersion: 1,
    id: 'workflow',
    revision: 1,
    name: 'Workflow',
    nodes: withEnd,
    edges: [...edges, ...boundaryEdges],
    runContext: {
      kind: 'workspace-run',
      projectId: 'project',
      hostId: 'local',
      projectHostSetupId: 'setup',
      repoId: 'repo',
      path: '/workspace'
    },
    workspace: { mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' },
    trigger: { manual: true, schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

function start(): AgentsWorkflowNode {
  return {
    id: 'start',
    kind: 'start',
    title: 'Start',
    position: { x: 0, y: 0 }
  }
}

function end(): AgentsWorkflowNode {
  return {
    id: 'end',
    kind: 'end',
    title: 'End',
    position: { x: 0, y: 0 }
  }
}

function command(id: string, commandLine: string): AgentsWorkflowNode {
  return {
    id,
    kind: 'command',
    title: id,
    position: { x: 0, y: 0 },
    command: commandLine
  }
}

describe('workflow graph validation and compilation', () => {
  it('compiles a deterministic ordinary DAG', () => {
    const workflow = definition(
      [start(), node('b'), node('a')],
      [edge('to-b', 'start', 'b'), edge('to-a', 'start', 'a'), edge('a-to-b', 'a', 'b')]
    )

    expect(validateWorkflowDefinition(workflow)).toEqual([])
    expect(compileWorkflowGraph(workflow)).toMatchObject({
      ok: true,
      graph: {
        startNodeId: 'start',
        topologicalNodeIds: ['start', 'a', 'b', 'end']
      }
    })
  })

  it('accepts a workflow that goes straight from start to end', () => {
    const workflow = definition(
      [start(), { id: 'end', kind: 'end', title: 'End', position: { x: 100, y: 0 } }],
      [edge('start-end', 'start', 'end')]
    )

    expect(validateWorkflowDefinition(workflow)).toEqual([])
    expect(compileWorkflowGraph(workflow)).toMatchObject({ ok: true })
  })

  it('rejects a graph with more than one end node', () => {
    const workflow = definition(
      [
        start(),
        node('a'),
        { id: 'end-1', kind: 'end', title: 'End 1', position: { x: 0, y: 0 } },
        { id: 'end-2', kind: 'end', title: 'End 2', position: { x: 0, y: 0 } }
      ],
      [edge('to-a', 'start', 'a'), edge('a-end-1', 'a', 'end-1'), edge('a-end-2', 'a', 'end-2')]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('end_count')
    expect(compileWorkflowGraph(workflow)).toMatchObject({ ok: false })
  })

  it('rejects an edge that leaves the end node', () => {
    const workflow = definition(
      [start(), node('a'), { id: 'end', kind: 'end', title: 'End', position: { x: 0, y: 0 } }],
      [edge('to-a', 'start', 'a'), edge('a-end', 'a', 'end'), edge('end-a', 'end', 'a')]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('invalid_source_port')
  })

  it('rejects a node whose path never reaches the end node', () => {
    const workflow = definition(
      [start(), node('a'), node('b')],
      [edge('to-a', 'start', 'a'), edge('a-b', 'a', 'b'), edge('b-a', 'b', 'a')]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('node_not_reaching_end')
    expect(compileWorkflowGraph(workflow)).toMatchObject({ ok: false })
  })

  it('compiles a single-layer loop', () => {
    const loop: AgentsWorkflowNode = {
      id: 'loop',
      kind: 'loop',
      title: 'Loop',
      position: { x: 100, y: 0 },
      count: 3
    }
    const body = node('body', { prompt: { source: 'Handle this turn.' } })
    const done = node('done', { prompt: { source: 'Summarize.' } })
    const workflow = definition(
      [start(), loop, body, done],
      [
        edge('start-loop', 'start', 'loop'),
        edge('loop-body', 'loop', 'body', { fromPort: 'each' }),
        edge('body-loop', 'body', 'loop', { toPort: 'aggregate' }),
        edge('loop-done', 'loop', 'done', { fromPort: 'done' })
      ]
    )

    expect(validateWorkflowDefinition(workflow)).toEqual([])
    expect(compileWorkflowGraph(workflow)).toMatchObject({
      ok: true,
      graph: {
        loopRegions: [
          {
            loopNodeId: 'loop',
            eachTargetNodeId: 'body',
            exitNodeId: 'body',
            doneTargetNodeId: 'done',
            bodyNodeIds: ['body']
          }
        ]
      }
    })
  })

  it('rejects a loop body that dead-ends before the aggregate exit', () => {
    const loop: AgentsWorkflowNode = {
      id: 'loop',
      kind: 'loop',
      title: 'Loop',
      position: { x: 100, y: 0 },
      count: 3
    }
    const workflow = definition(
      [start(), loop, node('body'), node('exit'), node('done')],
      [
        edge('start-loop', 'start', 'loop'),
        edge('loop-body', 'loop', 'body', { fromPort: 'each' }),
        edge('loop-done', 'loop', 'done', { fromPort: 'done' }),
        edge('exit-loop', 'exit', 'loop', { toPort: 'aggregate' }),
        edge('start-exit', 'start', 'exit')
      ]
    )

    // Why rejected here: the body can never reach `exit`, so every iteration would fail at run
    // time with `loop_output_missing` instead of being caught on the canvas.
    expect(validateWorkflowDefinition(workflow).map((issue) => issue.code)).toContain(
      'loop_body_escape'
    )
  })

  it('rejects loop body cross-boundary edges and nested loops', () => {
    const outer: AgentsWorkflowNode = {
      id: 'outer',
      kind: 'loop',
      title: 'Outer',
      position: { x: 0, y: 0 },
      count: 2
    }
    const inner: AgentsWorkflowNode = {
      id: 'inner',
      kind: 'loop',
      title: 'Inner',
      position: { x: 0, y: 0 },
      count: 2
    }
    const workflow = definition(
      [start(), outer, inner, node('exit'), node('done')],
      [
        edge('start-outer', 'start', 'outer'),
        edge('outer-inner', 'outer', 'inner', { fromPort: 'each' }),
        edge('inner-exit', 'inner', 'exit', { fromPort: 'done' }),
        edge('exit-outer', 'exit', 'outer', { toPort: 'aggregate' }),
        edge('outer-done', 'outer', 'done', { fromPort: 'done' }),
        edge('inner-each', 'inner', 'exit', { fromPort: 'each' }),
        edge('exit-inner', 'exit', 'inner', { toPort: 'aggregate' }),
        edge('start-exit', 'start', 'exit')
      ]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('nested_loop')
    expect(codes).toContain('loop_body_external_entry')
  })

  it('rejects a judging prompt that cannot produce a decision', () => {
    const workflow = definition(
      [
        start(),
        {
          id: 'check',
          kind: 'condition',
          title: 'Check',
          position: { x: 100, y: 0 },
          agentId: 'claude',
          prompt: { source: '   ' }
        },
        {
          id: 'other',
          kind: 'condition',
          title: 'Other',
          position: { x: 100, y: 200 },
          agentId: 'claude',
          prompt: { source: 'Decide whether the change is small.' }
        },
        node('done')
      ],
      [
        edge('start-check', 'start', 'check'),
        edge('check-yes', 'check', 'done', { fromPort: 'yes' }),
        edge('check-no', 'check', 'other', { fromPort: 'no' }),
        edge('other-yes', 'other', 'done', { fromPort: 'yes' }),
        edge('other-no', 'other', 'done', { fromPort: 'no' })
      ]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('condition_prompt_required')
    expect(codes).toContain('condition_decision_contract_missing')
  })

  it('accepts the template a condition starts with', () => {
    const workflow = definition(
      [
        start(),
        {
          id: 'check',
          kind: 'condition',
          title: 'Check',
          position: { x: 100, y: 0 },
          agentId: 'claude',
          prompt: {
            source:
              'Read the answer this node inherits, then decide whether it meets this condition:\n\n<write the condition here>\n\nAnswer with a single JSON object and nothing else: {"decision":"yes"} when the condition holds, {"decision":"no"} when it does not.'
          }
        },
        node('done')
      ],
      [
        edge('start-check', 'start', 'check'),
        edge('check-yes', 'check', 'done', { fromPort: 'yes' }),
        edge('check-no', 'check', 'done', { fromPort: 'no' })
      ]
    )

    expect(validateWorkflowDefinition(workflow)).toEqual([])
  })

  it('requires exactly one yes and one no edge for a judge condition', () => {
    const workflow = definition(
      [
        start(),
        {
          id: 'check',
          kind: 'condition',
          title: 'Check',
          position: { x: 100, y: 0 },
          agentId: 'claude',
          prompt: {
            source:
              'Decide whether the change is small. Answer with {"decision":"yes"} or {"decision":"no"}.'
          }
        },
        node('done')
      ],
      [edge('start-check', 'start', 'check'), edge('check-done', 'check', 'done')]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('condition_branch_count')
    expect(compileWorkflowGraph(workflow)).toMatchObject({ ok: false })
  })

  it('accepts a command node between two agent nodes', () => {
    const workflow = definition(
      [start(), node('first'), command('run', 'pnpm test'), node('last')],
      [
        edge('start-first', 'start', 'first'),
        edge('first-run', 'first', 'run'),
        edge('run-last', 'run', 'last')
      ]
    )

    expect(validateWorkflowDefinition(workflow)).toEqual([])
    expect(compileWorkflowGraph(workflow)).toMatchObject({ ok: true })
  })

  it('accepts a command node immediately before the end node', () => {
    const workflow = definition(
      [start(), node('first'), command('run', 'pnpm build')],
      [edge('start-first', 'start', 'first'), edge('first-run', 'first', 'run')]
    )

    expect(validateWorkflowDefinition(workflow)).toEqual([])
  })

  it('rejects a command node with an empty command', () => {
    const workflow = definition(
      [start(), command('run', '   '), node('done')],
      [edge('start-run', 'start', 'run'), edge('run-done', 'run', 'done')]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('command_required')
  })
})
