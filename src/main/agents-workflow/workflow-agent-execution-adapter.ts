import type { AgentsWorkflowStepExecutor } from './workflow-dynamic-scheduler'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import {
  agentsWorkflowAgentChannelPlan,
  agentsWorkflowNodeChannels,
  type AgentsWorkflowAgentChannel
} from '../../shared/agents-workflow-agent-channels'
import { captureAgentsWorkflowStructuredOutput } from './structured-agent-output-capture'
import type { AgentsWorkflowFileHandoffTurnRunner } from './workflow-file-handoff-runner'
import type { AgentsWorkflowReportTurnRunner } from './workflow-report-turn-runner'
import type { AgentsWorkflowTranscriptTurnRunner } from './workflow-transcript-turn-runner'

export type AgentsWorkflowExecutionAdapter = {
  execute: AgentsWorkflowStepExecutor
  cancel(runId: string): Promise<'stopped' | 'unverifiable'>
  /** Stops tracking a finished run. `reclaim` also closes the chats or panes it opened. */
  release?(runId: string, options: { reclaim: boolean }): Promise<void>
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
  release(runId: string, options: { reclaim: boolean }): Promise<void>
}

export type AgentsWorkflowRunChannel = AgentsWorkflowAgentChannel

/**
 * Refusals that mean "this run cannot take this channel", not "the turn went wrong". Only these
 * fall through to the next channel, and only before the channel opened a pane: falling through
 * after a turn ran would execute the same instruction a second time.
 */
const CHANNEL_UNAVAILABLE_CODES: Readonly<
  Partial<Record<AgentsWorkflowRunChannel, ReadonlySet<string>>>
> = {
  protocol: new Set([
    'structured_agent_unsupported',
    'structured_agent_location_unsupported',
    'structured_agent_host_unavailable'
  ]),
  // `transcript_turn_unavailable` is deliberately absent: the pane already ran and only the read
  // failed, so the node is a failure, not an invitation to re-run it through the file contract.
  transcript: new Set(['transcript_channel_unavailable'])
}

export function createAgentsWorkflowExecutionAdapter(
  runner: AgentsWorkflowStructuredTurnRunner,
  fileRunner?: AgentsWorkflowFileHandoffTurnRunner,
  transcriptRunner?: AgentsWorkflowTranscriptTurnRunner,
  reportRunner?: AgentsWorkflowReportTurnRunner
): AgentsWorkflowExecutionAdapter {
  // Which runner owns a run, so a cancel reaches the chat or the pane that is actually open.
  const channelByRunId = new Map<string, AgentsWorkflowRunChannel>()

  const runProtocol: AgentsWorkflowStepExecutor = async (input) => {
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
  }

  const unavailable = (agentId: string) => ({
    ok: false as const,
    code: 'agent_channel_unavailable',
    message: `This build has no output channel that can run ${agentId}.`
  })

  return {
    execute: async (input) => {
      const plan = agentsWorkflowAgentChannelPlan(input.node.agentId)
      if (plan === null) {
        return unavailable(input.node.agentId)
      }
      // Same selection the inspector displays, so a hint never promises a channel the run skips.
      const channels = agentsWorkflowNodeChannels(plan, {
        terminal: input.node.terminal,
        available: {
          protocol: true,
          transcript: transcriptRunner !== undefined,
          file: fileRunner !== undefined,
          snapshot: reportRunner !== undefined
        }
      })
      const open = (channel: AgentsWorkflowRunChannel) => {
        if (input.runId) {
          channelByRunId.set(input.runId, channel)
        }
      }
      const fellThrough = (channel: AgentsWorkflowRunChannel, code: string) =>
        CHANNEL_UNAVAILABLE_CODES[channel]?.has(code) ?? false

      // Ordered exactly as the registry declares, so a run takes the strongest channel this host
      // and this agent's version can actually deliver.
      for (const channel of channels) {
        if (channel === 'protocol') {
          open('protocol')
          const result = await runProtocol(input)
          if (result.ok || !fellThrough('protocol', result.code)) {
            return result
          }
          continue
        }
        if (channel === 'transcript' && transcriptRunner) {
          open('transcript')
          const result = await transcriptRunner.run(input)
          if (result.ok || !fellThrough('transcript', result.code)) {
            return result
          }
          continue
        }
        // File and snapshot are terminal channels: nothing follows them, so a failure is final.
        if (channel === 'file' && fileRunner) {
          open('file')
          return await fileRunner.run(input)
        }
        if (channel === 'snapshot' && reportRunner) {
          open('snapshot')
          return await reportRunner.run(input)
        }
      }
      if (input.runId) {
        channelByRunId.delete(input.runId)
      }
      return unavailable(input.node.agentId)
    },
    cancel: (runId) => {
      const channel = channelByRunId.get(runId)
      channelByRunId.delete(runId)
      if (channel === 'file' && fileRunner) {
        return fileRunner.cancel(runId)
      }
      if (channel === 'transcript' && transcriptRunner) {
        return transcriptRunner.cancel(runId)
      }
      if (channel === 'snapshot' && reportRunner) {
        return reportRunner.cancel(runId)
      }
      return runner.cancel(runId)
    },
    release: async (runId, options) => {
      channelByRunId.delete(runId)
      await runner.release(runId, options)
      await transcriptRunner?.release(runId, options)
      await fileRunner?.release(runId, options)
      await reportRunner?.release(runId, options)
    }
  }
}
