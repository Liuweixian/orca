import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentsWorkflowDefinition,
  AgentsWorkflowEdge,
  AgentsWorkflowNode
} from '../../shared/agents-workflow-types'
import { executeAgentsWorkflowSchedule } from './workflow-dynamic-scheduler'

const tempDirs: string[] = []

async function tempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-upstream-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

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

  it('fails closed when a value node only yields a terminal snapshot', async () => {
    const workflow = definition(
      [
        agent('work', { source: 'work', bindings: {} }),
        agent('done', { source: 'done', bindings: {} }, true)
      ],
      [edge('start-work', 'start', 'work'), edge('work-done', 'work', 'done')]
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

  it('accepts the output file as a value a downstream node can bind', async () => {
    const workflow = definition(
      [
        agent('first', { source: 'work', bindings: {} }),
        agent(
          'second',
          {
            source: 'use {{binding:value}}',
            bindings: { value: { kind: 'node_output', nodeId: 'first' } }
          },
          true
        )
      ],
      [edge('start-first', 'start', 'first'), edge('first-second', 'first', 'second')]
    )
    const prompts: string[] = []
    const workspacePath = await tempWorkspace()

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      runInput: '',
      executionContext: { runId: 'run-1', workspaceId: 'workspace-1', workspacePath },
      executeAgent: async ({ prompt }) => {
        prompts.push(prompt)
        return {
          ok: true,
          output: {
            format: 'plain_text',
            content: 'from the handoff file',
            capturedAt: 10,
            truncated: false,
            source: 'agent_file_handoff'
          }
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(prompts).toEqual(['work', 'use from the handoff file'])
  })

  it('completes a terminal node from a pane snapshot without publishing a value', async () => {
    const workflow = definition(
      [
        agent('first', { source: 'work', bindings: {} }),
        agent('report', { source: 'report', bindings: {} }, true)
      ],
      [edge('start-first', 'start', 'first'), edge('first-report', 'first', 'report')]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      runInput: '',
      executeAgent: async ({ node }) =>
        node.id === 'report'
          ? {
              ok: true,
              output: {
                format: 'plain_text',
                content: 'pane text',
                capturedAt: 10,
                truncated: true,
                source: 'terminal_snapshot'
              }
            }
          : {
              ok: true,
              output: {
                format: 'plain_text',
                content: 'the value',
                capturedAt: 10,
                truncated: false,
                source: 'agent_file_handoff'
              }
            }
    })

    expect(result.ok).toBe(true)
    expect(result.ok && result.attempts.map((attempt) => attempt.status)).toEqual([
      'completed',
      'completed'
    ])
    // The report node's text never becomes a bindable value.
    expect(result.ok && [...result.outputs.keys()]).toEqual(['first'])
  })

  it('saves the previous answer to a file and points the next prompt at it', async () => {
    const workflow = definition(
      [
        agent('first', { source: 'work', bindings: {} }),
        agent('second', { source: 'turn it into a todo list', bindings: {} }, true)
      ],
      [edge('start-first', 'start', 'first'), edge('first-second', 'first', 'second')]
    )
    const prompts: string[] = []
    const workspacePath = await tempWorkspace()

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      runInput: '',
      executionContext: { runId: 'run-1', workspaceId: 'workspace-1', workspacePath },
      executeAgent: async ({ prompt }) => {
        prompts.push(prompt)
        return {
          ok: true,
          output: {
            format: 'plain_text',
            content: prompts.length === 1 ? '# findings' : 'todo',
            capturedAt: 10,
            truncated: false,
            source: prompts.length === 1 ? 'agent_file_handoff' : 'terminal_snapshot'
          }
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(prompts).toEqual([
      'work',
      '<!-- orca:upstream:first -->\nread .orca-workflow/run-1/answers/first.md first, then\n\nturn it into a todo list'
    ])
    await expect(
      readFile(join(workspacePath, '.orca-workflow/run-1/answers/first.md'), 'utf8')
    ).resolves.toBe('# findings')
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
