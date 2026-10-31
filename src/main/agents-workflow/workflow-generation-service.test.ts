import { describe, expect, it, vi, type Mock } from 'vitest'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentsWorkflowRunDirectory } from '../../shared/agents-workflow-output-paths'
import {
  AGENTS_WORKFLOW_GENERATION_TIMEOUT_MS,
  generateAgentsWorkflowDraft
} from './workflow-generation-service'

function answered(text: string) {
  return {
    ok: true as const,
    output: {
      format: 'plain_text' as const,
      content: text,
      capturedAt: 2,
      truncated: false,
      source: 'agent_file_handoff' as const
    }
  }
}

const validWorkflow = JSON.stringify({
  name: 'Review changes',
  nodes: [
    { id: 'start', kind: 'start', title: 'Start' },
    {
      id: 'review',
      kind: 'agent',
      title: 'Review',
      agentId: 'claude',
      prompt: 'Review every changed file.'
    },
    { id: 'end', kind: 'end', title: 'End' }
  ],
  edges: [
    { id: 'e1', fromNodeId: 'start', toNodeId: 'review', fromPort: 'default', toPort: 'default' },
    { id: 'e2', fromNodeId: 'review', toNodeId: 'end', fromPort: 'default', toPort: 'default' }
  ]
})

function adapter(
  execute: Mock,
  release: Mock = vi.fn(async () => {})
): {
  execute: Mock
  release: Mock
} {
  return { execute, release }
}

describe('generateAgentsWorkflowDraft', () => {
  it('repairs an unusable answer in one more turn and reclaims the turn', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(answered('I could not think of a workflow.'))
      .mockResolvedValueOnce(answered(validWorkflow))
    const runner = adapter(execute)

    const result = await generateAgentsWorkflowDraft({
      runner,
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/workspace-1',
      agentId: 'claude',
      agentIds: ['claude'],
      request: 'Review my changes'
    })

    expect(result.draft.name).toBe('Review changes')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]?.[0]).toMatchObject({
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/workspace-1'
    })
    expect(String(execute.mock.calls[1]?.[0].prompt)).toContain('could not be run as a workflow')
    expect(runner.release).toHaveBeenCalledWith(expect.any(String), { reclaim: true })
  })

  it('stops after the repair turn still fails', async () => {
    const runner = adapter(vi.fn(async () => answered('{"name":"nope"}')))

    await expect(
      generateAgentsWorkflowDraft({
        runner,
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        agentId: 'claude',
        agentIds: ['claude'],
        request: 'Review my changes'
      })
    ).rejects.toThrow(/could not produce a valid workflow/i)
    expect(runner.execute).toHaveBeenCalledTimes(2)
    // Why: the failed design is the user's only evidence of what the agent answered.
    expect(runner.release).toHaveBeenCalledWith(expect.any(String), { reclaim: false })
  })

  // Why: a pane agent answers through its file or transcript, so the refusal is the turn's failure,
  // not a reason to fall back to a channel that would run the same instruction twice.
  it('bubbles the turn refusal instead of asking for a repair', async () => {
    const runner = adapter(
      vi.fn(async () => ({
        ok: false as const,
        code: 'output_contract_missing',
        message: 'The agent finished without writing the workflow output.'
      }))
    )

    await expect(
      generateAgentsWorkflowDraft({
        runner,
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        agentId: 'gemini',
        agentIds: ['gemini'],
        request: 'Review my changes'
      })
    ).rejects.toThrow(/without writing the workflow output\. \(output_contract_missing\)/)
    expect(runner.execute).toHaveBeenCalledTimes(1)
    // Why no reclaim: the chat or pane holds the answer that explains the refusal.
    expect(runner.release).toHaveBeenCalledWith(expect.any(String), { reclaim: false })
  })

  // Why: the file channel writes its contract inside the user's real checkout, and no run
  // lifecycle owns this runId to remove that folder afterwards.
  it('removes the run scratch the file channel wrote in the checkout', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'orca-generation-'))
    try {
      const execute = vi.fn(async (input: { runId: string; workspacePath: string }) => {
        await mkdir(agentsWorkflowRunDirectory(input.workspacePath, input.runId), {
          recursive: true
        })
        return answered(validWorkflow)
      })
      const runner = adapter(execute)

      await generateAgentsWorkflowDraft({
        runner,
        workspaceId: 'workspace-1',
        workspacePath,
        agentId: 'claude',
        agentIds: ['claude'],
        request: 'Review my changes'
      })

      const runId = execute.mock.calls[0]?.[0].runId
      expect(runId).toBeTruthy()
      if (!runId) {
        throw new Error('The generator did not name a run id.')
      }
      await expect(stat(agentsWorkflowRunDirectory(workspacePath, runId))).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  // Why: nobody watches the generator turn, so a turn that never answers must still be reclaimed.
  it('aborts and reclaims the turn when it runs out of time', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn(
        async (input: { signal?: AbortSignal }): Promise<never> =>
          await new Promise<never>((_resolve, reject) => {
            input.signal?.addEventListener('abort', () => reject(input.signal?.reason), {
              once: true
            })
          })
      )
      const runner = adapter(execute)

      const pending = generateAgentsWorkflowDraft({
        runner,
        workspaceId: 'workspace-1',
        workspacePath: '/tmp/workspace-1',
        agentId: 'claude',
        agentIds: ['claude'],
        request: 'Review my changes'
      })
      const assertion = expect(pending).rejects.toThrow(/did not finish designing/)
      await vi.advanceTimersByTimeAsync(AGENTS_WORKFLOW_GENERATION_TIMEOUT_MS)
      await assertion
      expect(runner.release).toHaveBeenCalledWith(expect.any(String), { reclaim: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('tells the agent which agents it may name, and to keep the workspace untouched', async () => {
    const runner = adapter(vi.fn(async (_input: { prompt: string }) => answered(validWorkflow)))

    await generateAgentsWorkflowDraft({
      runner,
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/workspace-1',
      agentId: 'claude',
      agentIds: ['claude', 'codex'],
      request: 'Review my changes'
    })

    const prompt = String(runner.execute.mock.calls[0]?.[0].prompt)
    expect(prompt).toContain('Use only these agent ids: claude, codex.')
    expect(prompt).toContain("This workspace is the user's real checkout")
  })
})
