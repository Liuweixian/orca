// A node's turn on a real pane, answered from the agent's own transcript.
//
// Nothing is appended to the prompt here: the agent already records what it answered, so the run
// reads that back. A channel this build cannot open falls through to the file contract; a turn that
// already ran but whose answer cannot be matched is a failure, never a re-run.

import type { AiVaultAgent } from '../../shared/ai-vault-types'
import type { AgentsWorkflowNodeOutput } from '../../shared/agents-workflow-run-types'
import { agentsWorkflowAgentChannelPlan } from '../../shared/agents-workflow-agent-channels'
import type { AgentsWorkflowStepExecutor } from './workflow-dynamic-scheduler'
import {
  paneTurnRefusal,
  WorkflowPaneTurns,
  type WorkflowPaneTurnRuntime
} from './workflow-pane-turn'
import {
  readWorkflowTranscriptTurn,
  type WorkflowTranscriptTurn
} from './workflow-transcript-reader'

export type AgentsWorkflowTranscriptTurnRunner = {
  run(
    input: Parameters<AgentsWorkflowStepExecutor>[0]
  ): Promise<
    | { ok: true; output: AgentsWorkflowNodeOutput }
    | { ok: false; code: string; message: string; unverifiable?: boolean }
  >
  cancel(runId: string): Promise<'stopped' | 'unverifiable'>
  /** Stops tracking a finished run. `reclaim` also closes its panes. */
  release(runId: string, options: { reclaim: boolean }): Promise<void>
}

type TranscriptReader = (input: {
  agent: AiVaultAgent
  workspacePath: string
  prompt: string
  startedAt: number
  signal?: AbortSignal
}) => Promise<WorkflowTranscriptTurn>

export class WorkflowTranscriptTurnRunner implements AgentsWorkflowTranscriptTurnRunner {
  private readonly panes: WorkflowPaneTurns

  constructor(
    runtime: WorkflowPaneTurnRuntime,
    private readonly readTurn: TranscriptReader = readWorkflowTranscriptTurn,
    private readonly now: () => number = Date.now
  ) {
    this.panes = new WorkflowPaneTurns(runtime)
  }

  async run(input: Parameters<AgentsWorkflowStepExecutor>[0]) {
    const { runId, workspaceId, workspacePath } = input
    if (!runId || !workspaceId) {
      return paneTurnRefusal(
        'workflow_execution_context_missing',
        'Workflow execution context is missing.'
      )
    }
    if (!workspacePath) {
      return paneTurnRefusal(
        'workflow_workspace_path_missing',
        'The workflow workspace has no path on this host.'
      )
    }
    const source = agentsWorkflowAgentChannelPlan(input.node.agentId)?.transcriptSource
    if (!source) {
      return paneTurnRefusal(
        'transcript_channel_unavailable',
        `Agent ${input.node.agentId} leaves no transcript this build can read.`
      )
    }

    const startedAt = this.now()
    const launched = await this.panes.launch({
      runId,
      nodeId: input.node.id,
      workspaceId,
      agent: input.node.agentId,
      prompt: input.prompt,
      title: input.node.title,
      ...(input.node.extraAgentArgs ? { extraAgentArgs: input.node.extraAgentArgs } : {})
    })
    if (!launched.ok) {
      return launched
    }
    const settled = await this.panes.settle(launched.handle, input.signal)
    if (!settled.ok) {
      return settled
    }

    const read = await this.readTurn({
      agent: source,
      workspacePath,
      prompt: input.prompt,
      startedAt,
      ...(input.signal ? { signal: input.signal } : {})
    })
    if (!read.ok) {
      if (input.signal?.aborted) {
        return paneTurnRefusal('cancelled', 'Workflow run was cancelled.', true)
      }
      return paneTurnRefusal('transcript_turn_unavailable', read.message)
    }
    return {
      ok: true as const,
      output: {
        format: 'plain_text' as const,
        content: read.content,
        capturedAt: this.now(),
        truncated: false,
        source: 'agent_transcript' as const
      }
    }
  }

  async cancel(runId: string): Promise<'stopped' | 'unverifiable'> {
    return await this.panes.cancel(runId)
  }

  async release(runId: string, options: { reclaim: boolean }): Promise<void> {
    await this.panes.release(runId, options)
  }
}

export function createWorkflowTranscriptTurnRunner(
  runtime: WorkflowPaneTurnRuntime,
  readTurn: TranscriptReader = readWorkflowTranscriptTurn,
  now: () => number = Date.now
): WorkflowTranscriptTurnRunner {
  return new WorkflowTranscriptTurnRunner(runtime, readTurn, now)
}
