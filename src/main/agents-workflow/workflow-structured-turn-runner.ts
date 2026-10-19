import { randomUUID } from 'node:crypto'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import {
  createStructuredAgentSessionOperationId,
  structuredAgentSessionPayloadFingerprint
} from '../../shared/structured-agent-session-mutation'
import {
  createStructuredAgentSessionId,
  structuredAgentSessionCreateParams
} from '../../shared/structured-agent-session-create'
import {
  structuredAgentSessionMessageSendMutation,
  structuredAgentSessionSendBody
} from '../../shared/structured-agent-session-send-mutation'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { closeStructuredAgentSessionChild } from '../runtime/structured-agent-session-close'
import { structuredAgentRuntimeMetadata } from '../runtime/structured-agent-runtime-metadata'
import { observeStructuredSession } from '../runtime/structured-worker-authority'
import { createStructuredAgentSessionForWorktree } from '../runtime/rpc/methods/structured-agent-session-create'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import type { AgentsWorkflowStructuredTurnRunner } from './workflow-agent-execution-adapter'
import { journalTurnItemIdForProviderTurn } from './provider-turn-journal-item'
import { waitStructuredAgentTurnCompletion } from './wait-structured-agent-turn-completion'

type StructuredWorkflowRuntime = Pick<
  OrcaRuntimeService,
  'ensureStructuredAgentSessionHost' | 'getStructuredAgentSessionCreateSupport'
>

type WorkflowStructuredHost = Pick<
  StructuredAgentSessionHost,
  'cancel' | 'journalSnapshot' | 'send' | 'subscribeTurnCompletions'
>

type WorkflowSessionCreator = (input: {
  caller: { callerKey: string }
  create: ReturnType<typeof structuredAgentSessionCreateParams>
}) => Promise<
  | { ok: true; value: { sessionId: string; fence: number } }
  | { ok: false; refusal: { code: string; message: string } }
>

type ActiveSession = {
  sessionId: string
  fence: number
  host: WorkflowStructuredHost
  caller: { callerKey: string }
}

function refusal(code: string, message: string, unverifiable = false) {
  return { ok: false as const, code, message, ...(unverifiable ? { unverifiable: true } : {}) }
}

export class WorkflowStructuredTurnRunner implements AgentsWorkflowStructuredTurnRunner {
  private readonly activeByRunId = new Map<string, ActiveSession>()

  constructor(
    private readonly runtime: StructuredWorkflowRuntime,
    private readonly createSession: WorkflowSessionCreator,
    private readonly hostReader: () => WorkflowStructuredHost | null = getStructuredAgentSessionHost
  ) {}

  async run(input: Parameters<AgentsWorkflowStructuredTurnRunner['run']>[0]) {
    try {
      return await this.runInternal(input)
    } catch (error) {
      return refusal(
        input.signal?.aborted ? 'cancelled' : 'structured_agent_execution_failed',
        error instanceof Error ? error.message : String(error),
        !input.signal?.aborted
      )
    }
  }

  private async runInternal(input: Parameters<AgentsWorkflowStructuredTurnRunner['run']>[0]) {
    if (!input.runId || !input.workspaceId) {
      return refusal('workflow_execution_context_missing', 'Workflow execution context is missing.')
    }
    const metadata = structuredAgentRuntimeMetadata(input.node.agentId)
    if (!metadata) {
      return refusal(
        'structured_agent_unsupported',
        `Agent ${input.node.agentId} does not support structured sessions.`
      )
    }
    if (input.node.extraAgentArgs) {
      return refusal(
        'structured_agent_arguments_unsupported',
        'Extra terminal agent arguments cannot be applied to structured sessions.'
      )
    }

    const selector = `id:${input.workspaceId}`
    const support = await this.runtime.getStructuredAgentSessionCreateSupport(
      selector,
      metadata.definition.agent
    )
    if (!support.supported) {
      return refusal(
        'structured_agent_location_unsupported',
        `Structured agent execution is unavailable for this workspace (${support.reason ?? 'unknown'}).`
      )
    }

    await this.runtime.ensureStructuredAgentSessionHost()
    const host = this.hostReader()
    if (!host) {
      return refusal(
        'structured_agent_host_unavailable',
        'The structured agent-session host is unavailable.'
      )
    }

    const caller = { callerKey: `agents-workflow:${input.runId}` }
    const create = structuredAgentSessionCreateParams({
      sessionId: createStructuredAgentSessionId(metadata.definition.agent, randomUUID),
      worktree: selector,
      agent: metadata.definition.agent,
      randomUuid: randomUUID
    })
    const created = await this.createSession({ caller, create })
    if (!created.ok) {
      return refusal(created.refusal.code, created.refusal.message)
    }

    const active = {
      sessionId: created.value.sessionId,
      fence: created.value.fence,
      host,
      caller
    }
    this.activeByRunId.set(input.runId, active)
    try {
      return await this.executeTurn(active, input.prompt, input.signal)
    } catch (error) {
      return refusal(
        input.signal?.aborted ? 'cancelled' : 'structured_agent_turn_failed',
        error instanceof Error ? error.message : String(error),
        !input.signal?.aborted
      )
    } finally {
      if (this.activeByRunId.get(input.runId) === active) {
        this.activeByRunId.delete(input.runId)
      }
      try {
        await closeStructuredAgentSessionChild(active.sessionId)
      } catch {
        // A completed turn remains authoritative even if background-session cleanup is uncertain.
      }
    }
  }

  async cancel(runId: string): Promise<'stopped' | 'unverifiable'> {
    const active = this.activeByRunId.get(runId)
    if (!active) {
      return 'unverifiable'
    }
    const clientOperationId = createStructuredAgentSessionOperationId(randomUUID)
    const fields = {}
    try {
      await active.host.cancel(active.caller, {
        envelope: {
          sessionId: active.sessionId,
          clientOperationId,
          expectedRuntimeFence: active.fence,
          payloadFingerprint: structuredAgentSessionPayloadFingerprint({
            method: 'agentSession.cancel',
            sessionId: active.sessionId,
            fields
          })
        }
      })
    } catch {
      // Closing still provides the authoritative child-exit observation.
    }
    await closeStructuredAgentSessionChild(active.sessionId)
    return observeStructuredSession(active.sessionId).status === 'exited'
      ? 'stopped'
      : 'unverifiable'
  }

  private async executeTurn(
    active: ActiveSession,
    prompt: string,
    signal?: AbortSignal
  ): Promise<{
    ok: true
    items: readonly AgentJournalRenderItem[]
    turnItemId: string
    awaitingUser: boolean
    capturedAt: number
  }> {
    const clientMessageId = createStructuredAgentSessionOperationId(randomUUID)
    const settled = await waitStructuredAgentTurnCompletion({
      host: active.host,
      sessionId: active.sessionId,
      subscriberId: `agents-workflow:${clientMessageId}`,
      signal,
      send: async () => {
        const sent = await active.host.send(active.caller, {
          ...structuredAgentSessionMessageSendMutation({
            sessionId: active.sessionId,
            clientOperationId: clientMessageId,
            expectedRuntimeFence: active.fence,
            body: structuredAgentSessionSendBody(prompt, [])
          })
        })
        if (!sent.ok) {
          throw new Error(`${sent.refusal.code}: ${sent.refusal.message}`)
        }
        return sent
      }
    })
    const snapshot = await active.host.journalSnapshot(active.sessionId)
    const turnItemId = journalTurnItemIdForProviderTurn(snapshot.items, settled.completion.turnId)
    if (!turnItemId) {
      throw new Error('The completed provider turn is missing from the structured journal.')
    }
    return {
      ok: true,
      items: snapshot.items,
      turnItemId,
      awaitingUser: settled.completion.awaitingUser === true,
      capturedAt: settled.completion.completedAt
    }
  }
}

export function createWorkflowStructuredTurnRunner(
  runtime: OrcaRuntimeService
): WorkflowStructuredTurnRunner {
  return new WorkflowStructuredTurnRunner(runtime, ({ caller, create }) =>
    createStructuredAgentSessionForWorktree({
      runtime,
      ensureHost: async () => {
        await runtime.ensureStructuredAgentSessionHost()
        const host = getStructuredAgentSessionHost()
        if (!host) {
          throw new Error('The structured agent-session host is unavailable.')
        }
        return host
      },
      caller,
      envelope: create.envelope,
      worktree: create.worktree,
      agent: create.agent,
      activate: false
    })
  )
}
