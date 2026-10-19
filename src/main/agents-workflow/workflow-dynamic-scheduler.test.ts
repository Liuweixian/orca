import { describe, expect, it, vi } from 'vitest'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../shared/agents-workflow-types'
import { executeAgentsWorkflowSchedule } from './workflow-dynamic-scheduler'

function agent(
  id: string,
  prompt: Extract<AgentsWorkflowNode, { kind: 'agent' }>['prompt'],
  terminal = false
): AgentsWorkflowNode {
  return {
    id,
    kind: 'agent',
    title: id,
    position: { x: 0, y: 0 },
    agentId: 'claude',
    prompt,
    terminal
  }
}

function edge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  ports: Partial<Pick<AgentsWorkflowEdge, 'fromPort' | 'toPort'>> = {}
): AgentsWorkflowEdge {
  return {
    id,
    fromNodeId,
    toNodeId,
    fromPort: 'default',
    toPort: 'default',
    ...ports
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

describe('executeAgentsWorkflowSchedule', () => {
  it('executes fixed loop iterations serially and releases the aggregate afterward', async () => {
    const loop: AgentsWorkflowNode = {
      id: 'loop',
      kind: 'loop',
      title: 'Loop',
      position: { x: 0, y: 0 },
      iteration: { mode: 'fixed', count: 3 }
    }
    const workflow = definition(
      [
        loop,
        agent('body', {
          source: '{{binding:item}} #{{binding:index}}',
          bindings: {
            item: { kind: 'loop_item', loopNodeId: 'loop' },
            index: { kind: 'loop_index', loopNodeId: 'loop' }
          }
        }),
        agent(
          'done',
          {
            source: '{{binding:results}}',
            bindings: { results: { kind: 'loop_output', loopNodeId: 'loop' } }
          },
          true
        )
      ],
      [
        edge('start-loop', 'start', 'loop'),
        edge('loop-body', 'loop', 'body', { fromPort: 'each' }),
        edge('body-loop', 'body', 'loop', { toPort: 'aggregate' }),
        edge('loop-done', 'loop', 'done', { fromPort: 'done' })
      ]
    )
    const prompts: string[] = []
    const executeAgent = vi.fn(async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt)
      return {
        ok: true as const,
        output: {
          format: 'plain_text' as const,
          content: prompt,
          capturedAt: 10,
          truncated: false,
          source: 'structured_assistant_message' as const
        }
      }
    })

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      runInput: '',
      executeAgent
    })

    expect(result.ok).toBe(true)
    expect(prompts).toEqual(['1 #0', '2 #1', '3 #2', '["1 #0","2 #1","3 #2"]'])
    expect(result.executionTrace).toEqual(['start', 'loop', 'body', 'body', 'body', 'done'])
  })

  it('fails closed when an agent only yields a terminal snapshot', async () => {
    const workflow = definition(
      [agent('done', { source: 'work', bindings: {} }, true)],
      [edge('start-done', 'start', 'done')]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      runInput: '',
      executeAgent: async () => ({
        ok: true,
        output: {
          format: 'plain_text',
          content: 'shell output',
          capturedAt: 10,
          truncated: false,
          source: 'terminal_snapshot'
        }
      })
    })

    expect(result).toMatchObject({ ok: false, code: 'output_untrusted' })
  })

  it('checkpoints a running attempt before invoking the agent', async () => {
    const workflow = definition(
      [agent('done', { source: 'work', bindings: {} }, true)],
      [edge('start-done', 'start', 'done')]
    )
    const events: string[] = []

    await executeAgentsWorkflowSchedule({
      definition: workflow,
      runInput: '',
      checkpoint: async ({ attempts }) => {
        events.push(`persist:${attempts.at(-1)?.status ?? 'none'}`)
      },
      executeAgent: async () => {
        events.push('execute')
        return {
          ok: true,
          output: {
            format: 'plain_text',
            content: 'done',
            capturedAt: 10,
            truncated: false,
            source: 'structured_assistant_message'
          }
        }
      }
    })

    expect(events.slice(0, 2)).toEqual(['persist:running', 'execute'])
  })
})
