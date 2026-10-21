// A report node's turn: run the agent in a pane, record what it said, hand nothing downstream.
//
// The node ends its branch, so no value is needed and the prompt is left exactly as the user wrote
// it. The pane's text is run-history evidence only.

import type { AgentsWorkflowNodeOutput } from '../../shared/agents-workflow-run-types'
import { createHeadlessAutomationOutputSnapshotBuffer } from '../automations/headless-dispatch'
import type { AgentsWorkflowStepExecutor } from './workflow-dynamic-scheduler'
import {
  paneTurnRefusal,
  WorkflowPaneTurns,
  type WorkflowPaneTurnRuntime
} from './workflow-pane-turn'

/** Quiet window sampled after the pane settles, so a half-rendered frame is not the record. */
const TAIL_STABLE_POLL_MS = 500
const TAIL_STABLE_DEADLINE_MS = 20_000
/** A fresh pane shows its shell prompt first; wait for the agent to paint over it. */
const TAIL_CHANGE_DEADLINE_MS = 60_000

export type AgentsWorkflowReportTurnRunner = {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class WorkflowReportTurnRunner implements AgentsWorkflowReportTurnRunner {
  private readonly panes: WorkflowPaneTurns

  constructor(
    runtime: WorkflowPaneTurnRuntime,
    private readonly now: () => number = Date.now
  ) {
    this.panes = new WorkflowPaneTurns(runtime)
  }

  async run(input: Parameters<AgentsWorkflowStepExecutor>[0]) {
    const { runId, workspaceId } = input
    if (!runId || !workspaceId) {
      return paneTurnRefusal(
        'workflow_execution_context_missing',
        'Workflow execution context is missing.'
      )
    }

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

    const tail = await this.stableTail(launched.handle, input.signal)
    const buffer = createHeadlessAutomationOutputSnapshotBuffer()
    buffer.append(tail.join('\n'))
    const snapshot = buffer.snapshot()
    return {
      ok: true as const,
      output: {
        format: 'plain_text' as const,
        content: snapshot?.content ?? '',
        capturedAt: snapshot?.capturedAt ?? this.now(),
        truncated: snapshot?.truncated ?? true,
        source: 'terminal_snapshot' as const
      }
    }
  }

  async cancel(runId: string): Promise<'stopped' | 'unverifiable'> {
    return await this.panes.cancel(runId)
  }

  async release(runId: string, options: { reclaim: boolean }): Promise<void> {
    await this.panes.release(runId, options)
  }

  /**
   * Reads until the agent has painted over its first frame and the pane then stops changing, so
   * the record is the answer rather than the shell prompt the pane opened with.
   */
  private async stableTail(handle: string, signal?: AbortSignal): Promise<string[]> {
    const changeBy = this.now() + TAIL_CHANGE_DEADLINE_MS
    let baseline: string | null = null
    let tail = await this.panes.readTail(handle)
    while (baseline === null || tail.join('\n') === baseline) {
      baseline ??= tail.join('\n')
      if (signal?.aborted || this.now() >= changeBy) {
        return tail
      }
      await delay(TAIL_STABLE_POLL_MS)
      tail = await this.panes.readTail(handle)
    }

    const stableBy = this.now() + TAIL_STABLE_DEADLINE_MS
    let previous: string | null = null
    while (true) {
      const text = tail.join('\n')
      if (previous !== null && text === previous) {
        return tail
      }
      previous = text
      if (signal?.aborted || this.now() >= stableBy) {
        return tail
      }
      await delay(TAIL_STABLE_POLL_MS)
      tail = await this.panes.readTail(handle)
    }
  }
}

export function createWorkflowReportTurnRunner(
  runtime: WorkflowPaneTurnRuntime,
  now: () => number = Date.now
): WorkflowReportTurnRunner {
  return new WorkflowReportTurnRunner(runtime, now)
}
