import { describe, expect, it } from 'vitest'
import {
  availableVariableRefs,
  compileWorkflowGraph,
  renderPrompt,
  validateWorkflowDefinition
} from './agents-workflow-graph'
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
    prompt: { source: '', bindings: {} },
    terminal: false,
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
  return {
    schemaVersion: 1,
    id: 'workflow',
    revision: 1,
    name: 'Workflow',
    nodes,
    edges,
    runContext: {
      kind: 'workspace-run',
      projectId: 'project',
      hostId: 'local',
      projectHostSetupId: 'setup',
      repoId: 'repo',
      path: '/workspace'
    },
    workspace: { mode: 'new_per_run', baseBranch: null, setupDecision: 'inherit' },
    trigger: { manual: true, defaultInput: '', schedule: null },
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

describe('workflow graph validation and compilation', () => {
  it('compiles a deterministic ordinary DAG', () => {
    const workflow = definition(
      [start(), node('b', { terminal: true }), node('a', { terminal: true })],
      [edge('to-b', 'start', 'b'), edge('to-a', 'start', 'a')]
    )

    expect(validateWorkflowDefinition(workflow)).toEqual([])
    expect(compileWorkflowGraph(workflow)).toMatchObject({
      ok: true,
      graph: {
        startNodeId: 'start',
        topologicalNodeIds: ['start', 'a', 'b']
      }
    })
  })

  it('requires strict dominance for node output references', () => {
    const workflow = definition(
      [
        start(),
        node('a'),
        node('b'),
        node('merge', {
          terminal: true,
          prompt: {
            source: '{{binding:a}}',
            bindings: { a: { kind: 'node_output', nodeId: 'a' } }
          }
        })
      ],
      [
        edge('start-a', 'start', 'a'),
        edge('start-b', 'start', 'b'),
        edge('a-merge', 'a', 'merge'),
        edge('b-merge', 'b', 'merge')
      ]
    )

    expect(availableVariableRefs(workflow, 'merge')).toEqual([{ kind: 'run_input' }])
    expect(validateWorkflowDefinition(workflow)).toContainEqual(
      expect.objectContaining({ code: 'variable_out_of_scope', nodeId: 'merge' })
    )
  })

  it('compiles a single-layer loop and exposes scoped loop variables', () => {
    const loop: AgentsWorkflowNode = {
      id: 'loop',
      kind: 'loop',
      title: 'Loop',
      position: { x: 100, y: 0 },
      iteration: { mode: 'fixed', count: 3 }
    }
    const body = node('body', {
      prompt: {
        source: '{{binding:item}} #{{binding:index}}',
        bindings: {
          item: { kind: 'loop_item', loopNodeId: 'loop' },
          index: { kind: 'loop_index', loopNodeId: 'loop' }
        }
      }
    })
    const done = node('done', {
      terminal: true,
      prompt: {
        source: '{{binding:results}}',
        bindings: { results: { kind: 'loop_output', loopNodeId: 'loop' } }
      }
    })
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
    expect(availableVariableRefs(workflow, 'body')).toEqual([
      { kind: 'run_input' },
      { kind: 'loop_item', loopNodeId: 'loop' },
      { kind: 'loop_index', loopNodeId: 'loop' }
    ])
    expect(availableVariableRefs(workflow, 'done')).toEqual([
      { kind: 'run_input' },
      { kind: 'loop_output', loopNodeId: 'loop' }
    ])
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

  it('rejects loop body cross-boundary edges and nested loops', () => {
    const outer: AgentsWorkflowNode = {
      id: 'outer',
      kind: 'loop',
      title: 'Outer',
      position: { x: 0, y: 0 },
      iteration: { mode: 'fixed', count: 2 }
    }
    const inner: AgentsWorkflowNode = {
      id: 'inner',
      kind: 'loop',
      title: 'Inner',
      position: { x: 0, y: 0 },
      iteration: { mode: 'fixed', count: 2 }
    }
    const workflow = definition(
      [start(), outer, inner, node('exit'), node('done', { terminal: true })],
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

  it('rejects malformed tokens and missing bindings', () => {
    const workflow = definition(
      [
        start(),
        node('done', {
          terminal: true,
          prompt: { source: '{{title}} {{binding:missing}}', bindings: {} }
        })
      ],
      [edge('start-done', 'start', 'done')]
    )
    const codes = validateWorkflowDefinition(workflow).map((entry) => entry.code)

    expect(codes).toContain('prompt_token_invalid')
    expect(codes).toContain('prompt_binding_missing')
  })
})

describe('renderPrompt', () => {
  const values = {
    runInput: 'release',
    nodeOutputs: { draft: 'notes' },
    loopItems: {},
    loopIndexes: {},
    loopOutputs: {}
  }

  it('renders stable binding tokens without resolving display titles', () => {
    expect(
      renderPrompt(
        {
          source: 'Prepare {{binding:input}} from {{binding:draft}}.',
          bindings: {
            input: { kind: 'run_input' },
            draft: { kind: 'node_output', nodeId: 'draft' }
          }
        },
        values
      )
    ).toEqual({ ok: true, value: 'Prepare release from notes.' })
  })

  it('fails when a binding value is unavailable', () => {
    expect(
      renderPrompt(
        {
          source: '{{binding:missing}}',
          bindings: { missing: { kind: 'node_output', nodeId: 'missing' } }
        },
        values
      )
    ).toMatchObject({ ok: false, code: 'missing_value', bindingKey: 'missing' })
  })
})
