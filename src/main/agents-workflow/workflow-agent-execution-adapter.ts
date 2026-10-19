import type { AgentsWorkflowStepExecutor } from './workflow-dynamic-scheduler'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import { captureAgentsWorkflowStructuredOutput } from './structured-agent-output-capture'

export type AgentsWorkflowExecutionAdapter = {
  execute: AgentsWorkflowStepExecutor
  cancel(runId: string): Promise<'stopped' | 'unverifiable'>
}

export type AgentsWorkflowStructuredTurnRunner = {
  run(input: Parameters<AgentsWorkflowStepExecutor>[0]): Promise<
    | {
        ok: true
        items: readonly AgentJournalRenderItem[]
        turnItemId: string
        awaitingUser: boolean
        capturedAt: number
      }
    | { ok: false; code: string; message: string; unverifiable?: boolean }
  >
  cancel(runId: string): Promise<'stopped' | 'unverifiable'>
}

export function createStructuredAgentsWorkflowExecutionAdapter(
  runner: AgentsWorkflowStructuredTurnRunner
): AgentsWorkflowExecutionAdapter {
  return {
    execute: async (input) => {
      const result = await runner.run(input)
      if (!result.ok) {
        return result
      }
      const captured = captureAgentsWorkflowStructuredOutput(result)
      if (!captured.ok) {
        return {
          ok: false,
          code: `structured_output_${captured.reason}`,
          message: 'The structured agent turn did not produce a trusted assistant output.'
        }
      }
      return { ok: true, output: captured.output }
    },
    cancel: (runId) => runner.cancel(runId)
  }
}

/**
 * The shared launch pipeline does not yet expose a headless structured-turn completion contract.
 * Refuse execution until that boundary exists so PTY text can never become a trusted output.
 */
export function createProductionAgentsWorkflowExecutionAdapter(): AgentsWorkflowExecutionAdapter {
  return {
    execute: async () => ({
      ok: false,
      code: 'structured_agent_execution_unavailable',
      message: 'Structured agent execution is unavailable on this build.'
    }),
    cancel: async () => 'unverifiable'
  }
}
