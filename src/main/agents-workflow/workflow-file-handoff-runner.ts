// A node's turn on a real pane, proven by the output file the prompt asked for.
//
// This is the channel every agent has: the prompt carries one extra instruction, the run reads the
// file the agent wrote, and a missing file is a failure rather than a guess. The pane's own text is
// never read for the value.

import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { AgentsWorkflowNodeOutput } from '../../shared/agents-workflow-run-types'
import type { AgentsWorkflowTurnSettlement } from '../../shared/agents-workflow-agent-channels'
import type { AgentsWorkflowStepExecutor } from './workflow-dynamic-scheduler'
import {
  agentsWorkflowHandoffPath,
  parseAgentsWorkflowHandoff,
  withAgentsWorkflowOutputContract
} from './workflow-file-handoff'
import {
  paneTurnRefusal,
  WorkflowPaneTurns,
  type WorkflowPaneTurn,
  type WorkflowPaneTurnRuntime
} from './workflow-pane-turn'
import { ensureAgentsWorkflowRunDirectory } from './workflow-run-scratch'

/**
 * How long a node may take to produce its file. The file is the value, so this is the clock's only
 * stop: a turn the agent never reports finishing, and a run that never writes the file, both end
 * here (or when the user cancels).
 */
const OUTPUT_FILE_TIMEOUT_MS = 30 * 60 * 1000
const OUTPUT_FILE_POLL_MS = 500
/** A turn the agent reported finishing gets this long to flush the file before a miss is final. */
const OUTPUT_FILE_SETTLE_GRACE_MS = 10_000
/**
 * The file must stop changing before it is the value. An agent that writes a skeleton first and
 * fills it in later must not hand its first draft downstream.
 */
const OUTPUT_FILE_STABILITY_MS = 2_000

export type AgentsWorkflowFileHandoffTurnRunner = {
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

export class WorkflowFileHandoffTurnRunner implements AgentsWorkflowFileHandoffTurnRunner {
  private readonly panes: WorkflowPaneTurns

  constructor(
    runtime: WorkflowPaneTurnRuntime,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs: number = OUTPUT_FILE_TIMEOUT_MS,
    private readonly pollMs: number = OUTPUT_FILE_POLL_MS,
    private readonly settleGraceMs: number = OUTPUT_FILE_SETTLE_GRACE_MS,
    private readonly stabilityMs: number = OUTPUT_FILE_STABILITY_MS
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

    const outputPath = agentsWorkflowHandoffPath({
      workspacePath,
      runId,
      nodeId: input.node.id,
      attempt: `${this.now()}-${randomUUID().slice(0, 8)}`
    })
    try {
      // The agent writes here, so the folder exists and git ignores it before the prompt names it.
      await ensureAgentsWorkflowRunDirectory(workspacePath, runId)
    } catch (error) {
      return paneTurnRefusal(
        'output_contract_unavailable',
        error instanceof Error ? error.message : String(error),
        true
      )
    }

    const launched = await this.panes.launch({
      runId,
      nodeId: input.node.id,
      workspaceId,
      agent: input.node.agentId,
      prompt: withAgentsWorkflowOutputContract(input.prompt, outputPath),
      title: input.node.title,
      ...(input.node.extraAgentArgs ? { extraAgentArgs: input.node.extraAgentArgs } : {})
    })
    if (!launched.ok) {
      return launched
    }
    return await this.readTurn(input, launched, outputPath)
  }

  async cancel(runId: string): Promise<'stopped' | 'unverifiable'> {
    return await this.panes.cancel(runId)
  }

  /** Closes panes on a scheduled run; the run's scratch folder is removed when it ends. */
  async release(runId: string, options: { reclaim: boolean }): Promise<void> {
    await this.panes.release(runId, options)
  }

  /**
   * Waits for the file the prompt asked for. A turn whose agent never reports completion gets the
   * full timeout; once the agent reports it, the file only gets a short grace period, so an agent
   * that answered without writing does not idle for half an hour.
   *
   * Two rules keep a half-written answer from becoming the node's value: the pane must have
   * settled before the file is read, and the file must have stopped changing for `stabilityMs`.
   */
  private async readTurn(
    input: Parameters<AgentsWorkflowStepExecutor>[0],
    turn: WorkflowPaneTurn,
    outputPath: string
  ) {
    const watcher = new AbortController()
    const abortWatcher = (): void => watcher.abort()
    input.signal?.addEventListener('abort', abortWatcher)
    // A box, not two locals: the settle callback writes them after TypeScript's narrowing pass.
    const pane: {
      failure: { ok: false; code: string; message: string; unverifiable?: boolean } | null
      settledAt: number | null
      failedAt: number | null
      settlement: AgentsWorkflowTurnSettlement | null
    } = { failure: null, settledAt: null, failedAt: null, settlement: null }
    void this.panes.settle(turn, watcher.signal).then(
      (result) => {
        if (result.ok) {
          pane.settledAt = this.now()
          pane.settlement = result.settlement
        } else {
          pane.failure = result
          pane.failedAt = this.now()
        }
      },
      // The watcher is aborted once the file settled the run; its teardown is not a failure.
      () => undefined
    )

    const deadlineAt = this.now() + this.timeoutMs
    let pending: { code: 'output_contract_empty'; message: string } | null = null
    let lastSignature: string | null = null
    let stableSince: number | null = null
    try {
      while (true) {
        if (input.signal?.aborted) {
          return paneTurnRefusal('cancelled', 'Workflow run was cancelled.')
        }
        const observation = await this.tryReadHandoff(outputPath)
        const now = this.now()
        if (observation !== null) {
          if (observation.signature !== lastSignature) {
            lastSignature = observation.signature
            stableSince = now
          }
          const read = observation.read
          if (!read.ok && read.code === 'output_contract_too_large') {
            return paneTurnRefusal(read.code, read.message)
          }
          if (read.ok) {
            // Why both conditions: a file written early is still the agent's scratch work, and a
            // file still growing is not its answer yet.
            const paneSettled = pane.settledAt !== null || pane.failure !== null
            const stable = stableSince !== null && now - stableSince >= this.stabilityMs
            if (paneSettled && stable) {
              return {
                ok: true as const,
                output: {
                  format: 'plain_text' as const,
                  content: read.content,
                  capturedAt: now,
                  truncated: false,
                  source: 'agent_file_handoff' as const
                }
              }
            }
          } else if (read.code === 'output_contract_empty') {
            // A half-written answer is empty; only the state at the deadline is final.
            pending = { code: read.code, message: read.message }
          }
        }

        if (pane.failure !== null) {
          // Why wait past the read: a closed pane can still leave the answer it already wrote.
          // An unverifiable end (a pane closed or reloaded) gets the same short grace as a
          // finished turn, so a last write can land.
          const failedGraceOver =
            pane.failedAt !== null && now >= pane.failedAt + this.settleGrace(pane.settlement)
          if (!pane.failure.unverifiable || failedGraceOver) {
            return pane.failure
          }
        }
        const graceOver =
          pane.settledAt !== null && now >= pane.settledAt + this.settleGrace(pane.settlement)
        if (graceOver || now >= deadlineAt) {
          if (pending !== null) {
            return paneTurnRefusal(pending.code, pending.message)
          }
          const minutes = Math.round(this.timeoutMs / 60_000)
          return paneTurnRefusal(
            'output_contract_missing',
            graceOver
              ? `The agent finished without writing the workflow output: ${outputPath}`
              : `The agent did not write the workflow output within ${minutes} minutes: ${outputPath}`
          )
        }
        await delay(this.pollMs)
      }
    } finally {
      watcher.abort()
      input.signal?.removeEventListener('abort', abortWatcher)
    }
  }

  /**
   * How long the file may still appear after the pane settled. A weak settlement is an idle
   * guess, not the agent saying "done", so an agent with no completion signal keeps the full
   * timeout instead of being failed ten seconds into a healthy three-minute task.
   */
  private settleGrace(settlement: AgentsWorkflowTurnSettlement | null): number {
    return settlement === 'idle-weak' ? this.timeoutMs : this.settleGraceMs
  }

  /** Null while the file is not there yet. */
  private async tryReadHandoff(
    outputPath: string
  ): Promise<{ read: ReturnType<typeof parseAgentsWorkflowHandoff>; signature: string } | null> {
    let signature: string
    try {
      const stats = await stat(outputPath)
      signature = `${stats.size}:${stats.mtimeMs}`
    } catch {
      return null
    }
    let raw: string
    try {
      raw = await readFile(outputPath, 'utf8')
    } catch {
      return null
    }
    return { read: parseAgentsWorkflowHandoff(raw), signature }
  }
}

export function createWorkflowFileHandoffTurnRunner(
  runtime: WorkflowPaneTurnRuntime,
  now: () => number = Date.now
): WorkflowFileHandoffTurnRunner {
  return new WorkflowFileHandoffTurnRunner(runtime, now)
}
