import { describe, expect, it } from 'vitest'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from './agents-workflow-types'
import {
  agentsWorkflowUpstreamInstruction,
  agentsWorkflowUpstreamPrompt,
  withAgentsWorkflowUpstream
} from './agents-workflow-upstream-prompt'

function node(id: string, kind: AgentsWorkflowNode['kind']): AgentsWorkflowNode {
  if (kind === 'agent') {
    return {
      id,
      kind,
      title: id,
      position: { x: 0, y: 0 },
      agentId: 'claude',
      prompt: { source: `${id} prompt` }
    }
  }
  if (kind === 'condition') {
    return {
      id,
      kind,
      title: id,
      position: { x: 0, y: 0 },
      agentId: 'claude',
      prompt: { source: 'judge prompt' }
    }
  }
  return {
    id,
    kind: 'loop',
    title: id,
    position: { x: 0, y: 0 },
    count: 1
  }
}

function edge(
  from: string,
  to: string,
  fromPort: AgentsWorkflowEdge['fromPort'] = 'default'
): AgentsWorkflowEdge {
  return { id: `${from}-${to}`, fromNodeId: from, toNodeId: to, fromPort, toPort: 'default' }
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
    nodes: [{ id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } }, ...nodes],
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
    trigger: { manual: true, schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

function upstream(
  workflow: AgentsWorkflowDefinition,
  nodeId: string,
  produced: string[],
  runId = 'run-1'
): string | null {
  return agentsWorkflowUpstreamPrompt({
    definition: workflow,
    nodeId,
    runId,
    hasValue: (id) => produced.includes(id)
  })
}

/** The instruction for a node whose title is its id, i.e. every fixture node. */
function read(nodeId: string): string {
  return agentsWorkflowUpstreamInstruction({ nodeId, title: nodeId, runId: 'run-1' })
}

describe('agents workflow upstream prompt', () => {
  it('tells the next node where the previous answer was saved', () => {
    const workflow = definition(
      [node('a', 'agent'), node('b', 'agent')],
      [edge('start', 'a'), edge('a', 'b')]
    )

    expect(upstream(workflow, 'b', ['a'])).toBe(read('a'))
    expect(withAgentsWorkflowUpstream('b prompt', upstream(workflow, 'b', ['a']))).toBe(
      `${read('a')}\n\nb prompt`
    )
  })

  it('looks through a condition, which hands on nothing of its own', () => {
    const workflow = definition(
      [node('a', 'agent'), node('check', 'condition'), node('b', 'agent')],
      [edge('start', 'a'), edge('a', 'check'), edge('check', 'b', 'yes')]
    )

    expect(upstream(workflow, 'b', ['a'])).toBe(read('a'))
  })

  it('hands a loop aggregate to the node after done', () => {
    const workflow = definition(
      [node('a', 'agent'), node('each', 'loop'), node('b', 'agent')],
      [edge('start', 'a'), edge('a', 'each'), edge('each', 'b', 'done')]
    )

    expect(upstream(workflow, 'b', ['a', 'each'])).toBe(read('each'))
  })

  it('names every predecessor that produced an answer', () => {
    const workflow = definition(
      [node('a', 'agent'), node('b', 'agent'), node('c', 'agent')],
      [edge('start', 'a'), edge('start', 'b'), edge('a', 'c'), edge('b', 'c')]
    )

    expect(upstream(workflow, 'c', ['a', 'b'])).toBe(`${read('a')}\n\n${read('b')}`)
  })

  it('gives the first node nothing to inherit', () => {
    const workflow = definition([node('a', 'agent')], [edge('start', 'a')])

    expect(upstream(workflow, 'a', [])).toBeNull()
    expect(withAgentsWorkflowUpstream('a prompt', null)).toBe('a prompt')
  })
})
