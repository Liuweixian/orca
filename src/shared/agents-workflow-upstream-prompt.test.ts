import { describe, expect, it } from 'vitest'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from './agents-workflow-types'
import {
  agentsWorkflowUpstreamMarker,
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
      prompt: { source: `${id} prompt`, bindings: {} },
      terminal: false
    }
  }
  if (kind === 'condition') {
    return {
      id,
      kind,
      title: id,
      position: { x: 0, y: 0 },
      input: { kind: 'run_input' },
      operator: 'not_empty'
    }
  }
  return {
    id,
    kind: 'loop',
    title: id,
    position: { x: 0, y: 0 },
    iteration: { mode: 'fixed', count: 1 }
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
    trigger: { manual: true, defaultInput: '', schedule: null },
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
  const target = workflow.nodes.find((candidate) => candidate.id === nodeId)
  return agentsWorkflowUpstreamPrompt({
    definition: workflow,
    nodeId,
    runId,
    hasValue: (id) => produced.includes(id),
    prompt: target?.kind === 'agent' ? target.prompt : { source: '', bindings: {} }
  })
}

describe('agents workflow upstream prompt', () => {
  it('tells the next node where the previous answer was saved', () => {
    const workflow = definition(
      [node('a', 'agent'), node('b', 'agent')],
      [edge('start', 'a'), edge('a', 'b')]
    )

    expect(upstream(workflow, 'b', ['a'])).toBe(
      `${agentsWorkflowUpstreamMarker('a')}\nread .orca-workflow/run-1/answers/a.md first, then`
    )
    expect(withAgentsWorkflowUpstream('b prompt', upstream(workflow, 'b', ['a']))).toBe(
      `${agentsWorkflowUpstreamMarker('a')}\nread .orca-workflow/run-1/answers/a.md first, then\n\nb prompt`
    )
  })

  it('looks through a condition, which hands on nothing of its own', () => {
    const workflow = definition(
      [node('a', 'agent'), node('check', 'condition'), node('b', 'agent')],
      [edge('start', 'a'), edge('a', 'check'), edge('check', 'b', 'yes')]
    )

    expect(upstream(workflow, 'b', ['a'])).toBe(
      `${agentsWorkflowUpstreamMarker('a')}\nread .orca-workflow/run-1/answers/a.md first, then`
    )
  })

  it('hands a loop aggregate to the node after done', () => {
    const workflow = definition(
      [node('a', 'agent'), node('each', 'loop'), node('b', 'agent')],
      [edge('start', 'a'), edge('a', 'each'), edge('each', 'b', 'done')]
    )

    expect(upstream(workflow, 'b', ['a', 'each'])).toBe(
      `${agentsWorkflowUpstreamMarker('each')}\nread .orca-workflow/run-1/answers/each.md first, then`
    )
  })

  it('does not repeat an answer the prompt already spells out', () => {
    const workflow = definition(
      [node('a', 'agent'), node('b', 'agent')],
      [edge('start', 'a'), edge('a', 'b')]
    )
    const b = workflow.nodes.find((candidate) => candidate.id === 'b')
    if (b?.kind !== 'agent') {
      throw new Error('fixture is missing b')
    }
    b.prompt = {
      source: 'summarize {{binding:a_output}}',
      bindings: { a_output: { kind: 'node_output', nodeId: 'a' } }
    }

    expect(upstream(workflow, 'b', ['a'])).toBeNull()
  })

  it('gives the first node nothing to inherit', () => {
    const workflow = definition([node('a', 'agent')], [edge('start', 'a')])

    expect(upstream(workflow, 'a', [])).toBeNull()
    expect(withAgentsWorkflowUpstream('a prompt', null)).toBe('a prompt')
  })
})
