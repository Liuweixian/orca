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
import { runWorkflowRegion } from './workflow-region-runner'
import type { WorkflowRegionContext } from './workflow-region-types'

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
  prompt: Extract<AgentsWorkflowNode, { kind: 'agent' }>['prompt']
): AgentsWorkflowNode {
  return {
    id,
    kind: 'agent',
    title: id,
    position: { x: 0, y: 0 },
    agentId: 'claude',
    prompt
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
    trigger: { manual: true, schedule: null },
    schedulerOwner: 'local_host_service',
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('executeAgentsWorkflowSchedule', () => {
  it('runs a fixed loop serially and releases the aggregate afterward', async () => {
    const loop: AgentsWorkflowNode = {
      id: 'loop',
      kind: 'loop',
      title: 'Loop',
      position: { x: 0, y: 0 },
      count: 3
    }
    const workflow = definition(
      [
        loop,
        agent('body', { source: 'Handle this turn.' }),
        agent('done', { source: 'Summarize the turns.' })
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
      executeAgent
    })

    expect(result.ok).toBe(true)
    expect(prompts).toEqual([
      'Handle this turn.',
      'Handle this turn.',
      'Handle this turn.',
      'Summarize the turns.'
    ])
    expect(result.executionTrace).toEqual(['start', 'loop', 'body', 'body', 'body', 'done'])
  })

  it('writes an iteration note and points the body prompt at it', async () => {
    const workflow = definition(
      [
        { id: 'loop', kind: 'loop', title: 'Loop', position: { x: 0, y: 0 }, count: 2 },
        agent('body', { source: 'Handle this turn.' }),
        agent('done', { source: 'Summarize the turns.' })
      ],
      [
        edge('start-loop', 'start', 'loop'),
        edge('loop-body', 'loop', 'body', { fromPort: 'each' }),
        edge('body-loop', 'body', 'loop', { toPort: 'aggregate' }),
        edge('loop-done', 'loop', 'done', { fromPort: 'done' })
      ]
    )
    const prompts: string[] = []
    const workspacePath = await tempWorkspace()

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executionContext: { runId: 'run-1', workspaceId: 'workspace-1', workspacePath },
      executeAgent: async ({ prompt }) => {
        prompts.push(prompt)
        return {
          ok: true,
          output: {
            format: 'plain_text',
            content: 'turn done',
            capturedAt: 10,
            truncated: false,
            source: 'structured_assistant_message'
          }
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(prompts[0]).toBe(
      '<!-- orca:upstream:loop -->\nread .orca-workflow/run-1/answers/loop.0.md first (loop "Loop" turn 1), then\n\nHandle this turn.'
    )
    expect(prompts[1]).toBe(
      '<!-- orca:upstream:loop -->\nread .orca-workflow/run-1/answers/loop.1.md first (loop "Loop" turn 2), then\n\nHandle this turn.'
    )
    await expect(
      readFile(join(workspacePath, '.orca-workflow/run-1/answers/loop.1.md'), 'utf8')
    ).resolves.toBe('{"iteration":2,"total":2}\n')
  })

  it('settles the branch a judge agent decides', async () => {
    const workflow = definition(
      [
        {
          id: 'check',
          kind: 'condition',
          title: 'Check',
          position: { x: 0, y: 0 },
          agentId: 'claude',
          prompt: {
            source:
              'Decide whether the change is small. Answer with {"decision":"yes"} or {"decision":"no"}.'
          }
        },
        agent('small', { source: 'small branch' }),
        agent('large', { source: 'large branch' }),
        agent('summary', { source: 'summarize the branch' })
      ],
      [
        edge('start-check', 'start', 'check'),
        edge('check-small', 'check', 'small', { fromPort: 'yes' }),
        edge('check-large', 'check', 'large', { fromPort: 'no' }),
        edge('small-summary', 'small', 'summary'),
        edge('large-summary', 'large', 'summary')
      ]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executeAgent: async ({ node }) => ({
        ok: true,
        output: {
          format: 'plain_text',
          content: node.id === 'check' ? '{"decision":"no"}' : 'branch',
          capturedAt: 10,
          truncated: false,
          source: 'structured_assistant_message'
        }
      })
    })

    expect(result.ok).toBe(true)
    expect(result.executionTrace).toEqual(['start', 'check', 'large', 'summary'])
    expect(result.attempts.find((attempt) => attempt.nodeId === 'small')).toMatchObject({
      status: 'skipped'
    })
  })

  it('fails instead of guessing when the judge does not answer with a decision', async () => {
    const workflow = definition(
      [
        {
          id: 'check',
          kind: 'condition',
          title: 'Check',
          position: { x: 0, y: 0 },
          agentId: 'claude',
          prompt: {
            source:
              'Decide whether the change is small. Answer with {"decision":"yes"} or {"decision":"no"}.'
          }
        },
        agent('small', { source: 'small branch' }),
        agent('large', { source: 'large branch' }),
        agent('summary', { source: 'summarize the branch' })
      ],
      [
        edge('start-check', 'start', 'check'),
        edge('check-small', 'check', 'small', { fromPort: 'yes' }),
        edge('check-large', 'check', 'large', { fromPort: 'no' }),
        edge('small-summary', 'small', 'summary'),
        edge('large-summary', 'large', 'summary')
      ]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executeAgent: async () => ({
        ok: true,
        output: {
          format: 'plain_text',
          content: 'It depends, probably yes.',
          capturedAt: 10,
          truncated: false,
          source: 'structured_assistant_message'
        }
      })
    })

    expect(result).toMatchObject({ ok: false, code: 'condition_decision_invalid' })
  })

  it('fails closed when a value node only yields a terminal snapshot', async () => {
    const workflow = definition(
      [agent('work', { source: 'work' }), agent('done', { source: 'done' })],
      [edge('start-work', 'start', 'work'), edge('work-done', 'work', 'done')]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
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

  it('completes a terminal node from a pane snapshot without publishing a value', async () => {
    const workflow = definition(
      [agent('first', { source: 'work' }), agent('report', { source: 'report' })],
      [edge('start-first', 'start', 'first'), edge('first-report', 'first', 'report')]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
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
      [agent('first', { source: 'work' }), agent('second', { source: 'turn it into a todo list' })],
      [edge('start-first', 'start', 'first'), edge('first-second', 'first', 'second')]
    )
    const prompts: string[] = []
    const workspacePath = await tempWorkspace()

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
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
      '<!-- orca:upstream:first -->\nread .orca-workflow/run-1/answers/first.md first (answer from "first"), then\n\nturn it into a todo list'
    ])
    await expect(
      readFile(join(workspacePath, '.orca-workflow/run-1/answers/first.md'), 'utf8')
    ).resolves.toBe('# findings')
  })

  it('checkpoints a running attempt before invoking the agent', async () => {
    const workflow = definition(
      [agent('done', { source: 'work' })],
      [edge('start-done', 'start', 'done')]
    )
    const events: string[] = []

    await executeAgentsWorkflowSchedule({
      definition: workflow,
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

  // Why: a closed pane or a dropped transport made the executor throw, which escaped the
  // scheduler: the run failed with a generic `workflow_execution_failed` and its attempt stayed
  // `running` forever.
  it('settles the attempt when the executor throws', async () => {
    const workflow = definition(
      [agent('done', { source: 'work' })],
      [edge('start-done', 'start', 'done')]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executeAgent: async () => {
        throw new Error('terminal_handle_stale')
      }
    })

    expect(result).toMatchObject({ ok: false, code: 'agent_turn_failed' })
    if (result.ok) {
      return
    }
    expect(result.message).toBe('terminal_handle_stale')
    expect(result.attempts.at(-1)).toMatchObject({
      nodeId: 'done',
      status: 'failed',
      errorCode: 'agent_turn_failed',
      errorMessage: 'terminal_handle_stale'
    })
  })

  // Why: a body node skipped this turn kept the previous turn's value in `nodeOutputs`, so a loop
  // whose exit was bypassed aggregated an answer that belonged to an earlier iteration. A valid
  // definition cannot bypass its exit, so the region runner is exercised directly.
  it('fails a loop turn whose exit node was skipped instead of reusing the previous answer', async () => {
    const workflow = definition(
      [
        { id: 'loop', kind: 'loop', title: 'Loop', position: { x: 0, y: 0 }, count: 2 },
        {
          id: 'check',
          kind: 'condition',
          title: 'Check',
          position: { x: 1, y: 0 },
          agentId: 'claude',
          prompt: {
            source: 'Decide whether to write. Answer with {"decision":"yes"} or {"decision":"no"}.'
          }
        },
        agent('body', { source: 'write the section' })
      ],
      [
        edge('start-loop', 'start', 'loop'),
        edge('loop-check', 'loop', 'check', { fromPort: 'each' }),
        edge('check-body', 'check', 'body', { fromPort: 'yes' }),
        // Why to the node after the loop: the no branch leaves the loop region, so the exit node
        // has no active input this turn.
        edge('check-after', 'check', 'after', { fromPort: 'no' }),
        edge('body-loop', 'body', 'loop', { toPort: 'aggregate' })
      ]
    )
    const values = {
      nodeOutputs: new Map([['body', 'answer from an earlier iteration']]),
      loopOutputs: new Map<string, string>()
    }
    const context: WorkflowRegionContext = {
      definition: workflow,
      loopRegions: [
        {
          loopNodeId: 'loop',
          eachTargetNodeId: 'check',
          doneTargetNodeId: 'after',
          exitNodeId: 'body',
          bodyNodeIds: ['body', 'check']
        }
      ],
      nodesById: new Map(workflow.nodes.map((node) => [node.id, node])),
      attempts: [],
      executionTrace: [],
      values,
      executeAgent: async () => ({
        ok: true as const,
        output: {
          format: 'plain_text' as const,
          content: '{"decision":"no"}',
          capturedAt: 10,
          truncated: false,
          source: 'structured_assistant_message' as const
        }
      }),
      now: () => 10,
      checkpoint: async () => undefined,
      captureOutputBytes: () => true
    }

    const failure = await runWorkflowRegion(context, new Set(['start', 'loop']), new Set(['start']))

    expect(failure).toMatchObject({ ok: false, code: 'loop_output_missing' })
  })

  it('stores a bounded copy of each answer instead of the whole text', async () => {
    const workflow = definition(
      [agent('finish', { source: 'Summarize.' })],
      [edge('start-finish', 'start', 'finish')]
    )
    const answer = 'x'.repeat(32 * 1024)
    const captured: { output: { content: string; truncated: boolean } | null }[] = []

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executeAgent: async () => ({
        ok: true,
        output: {
          format: 'plain_text',
          content: answer,
          capturedAt: 10,
          truncated: false,
          source: 'structured_assistant_message'
        }
      }),
      checkpoint: async ({ attempts }) => {
        captured.length = 0
        captured.push(...attempts)
      }
    })

    // Why bounded: run history retains 100 runs per workflow, so a full copy of every answer made
    // the stored domain grow with the run's output. The next node read the full text from its file.
    expect(result.ok).toBe(true)
    const stored = captured.find((attempt) => attempt.output !== null)
    expect(stored?.output?.truncated).toBe(true)
    expect(Buffer.byteLength(stored?.output?.content ?? '', 'utf8')).toBeLessThanOrEqual(8 * 1024)
  })

  it('runs a command node and hands its output to the next prompt', async () => {
    const workflow = definition(
      [command('build', 'node -p 1+1'), agent('report', { source: 'report it' })],
      [edge('start-build', 'start', 'build'), edge('build-report', 'build', 'report')]
    )
    const workspacePath = await tempWorkspace()
    const prompts: string[] = []

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executionContext: { runId: 'run-1', workspaceId: 'workspace-1', workspacePath },
      executeAgent: async ({ prompt }) => {
        prompts.push(prompt)
        return {
          ok: true,
          output: {
            format: 'plain_text',
            content: 'reported',
            capturedAt: 10,
            truncated: false,
            source: 'structured_assistant_message'
          }
        }
      }
    })

    expect(result.ok).toBe(true)
    expect(
      result.ok && result.attempts.find((attempt) => attempt.nodeId === 'build')
    ).toMatchObject({
      status: 'completed',
      output: { source: 'command_output' }
    })
    expect(prompts[0]).toContain('read .orca-workflow/run-1/answers/build.md first')
    await expect(
      readFile(join(workspacePath, '.orca-workflow/run-1/answers/build.md'), 'utf8')
    ).resolves.toContain('2')
  })

  it('fails the run when the command exits non-zero', async () => {
    const workflow = definition(
      [command('build', 'exit 3'), agent('report', { source: 'report it' })],
      [edge('start-build', 'start', 'build'), edge('build-report', 'build', 'report')]
    )
    const workspacePath = await tempWorkspace()

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executionContext: { runId: 'run-1', workspaceId: 'workspace-1', workspacePath },
      executeAgent: async () => {
        throw new Error('the agent must not run')
      }
    })

    expect(result).toMatchObject({ ok: false, code: 'command_failed' })
    expect(result.attempts.find((attempt) => attempt.nodeId === 'build')).toMatchObject({
      status: 'failed',
      errorCode: 'command_failed'
    })
  })

  it('fails a command node when the run has no workspace', async () => {
    const workflow = definition(
      [command('build', 'node -p 1+1'), agent('report', { source: 'report it' })],
      [edge('start-build', 'start', 'build'), edge('build-report', 'build', 'report')]
    )

    const result = await executeAgentsWorkflowSchedule({
      definition: workflow,
      executeAgent: async () => {
        throw new Error('the agent must not run')
      }
    })

    expect(result).toMatchObject({ ok: false, code: 'workspace_unavailable' })
  })
})
