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
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import { closeStructuredAgentSessionChild } from '../runtime/structured-agent-session-close'
import { structuredAgentRuntimeMetadata } from '../runtime/structured-agent-runtime-metadata'
import { observeStructuredSession } from '../runtime/structured-worker-authority'
import { createStructuredAgentSessionForWorktree } from '../runtime/rpc/methods/structured-agent-session-create'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import type { AgentsWorkflowStructuredTurnRunner } from './workflow-agent-execution-adapter'
import { journalTurnItemIdForProviderTurn } from './provider-turn-journal-item'
import {
  AgentsWorkflowAgentSessionClosedError,
  waitStructuredAgentTurnCompletion
} from './wait-structured-agent-turn-completion'

type StructuredWorkflowRuntime = Pick<
  OrcaRuntimeService,
  'ensureStructuredAgentSessionHost' | 'getStructuredAgentSessionCreateSupport'
>

type WorkflowStructuredHost = Pick<
  StructuredAgentSessionHost,
  'cancel' | 'journalSnapshot' | 'send' | 'subscribeTurnCompletions'
> & {
  /** Committed provider deaths, so a chat the user closes ends its node instead of stalling it. */
  readonly deps: { readonly store: Pick<AgentSessionRecordStore, 'onDeathEvidence'> }
}

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
  workspaceId: string
  agent: string
}

function refusal(code: string, message: string, unverifiable = false) {
  return { ok: false as const, code, message, ...(unverifiable ? { unverifiable: true } : {}) }
}

export class WorkflowStructuredTurnRunner implements AgentsWorkflowStructuredTurnRunner {
  /** Chats this run opened, per node: a retried node continues its own chat and nothing else. */
  private readonly sessionsByRunId = new Map<string, Map<string, ActiveSession>>()

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

    const runId = input.runId
    const workspaceId = input.workspaceId
    const nodeId = input.node.id
    const sessions = this.sessionsByRunId.get(runId)
    const tracked = sessions?.get(nodeId)
    // Why a node keeps its own chat: a retry should continue where that node left off, and a node
    // on another agent or workspace needs a chat of that agent's own.
    const reuse =
      tracked && tracked.workspaceId === workspaceId && tracked.agent === metadata.definition.agent
        ? tracked
        : null
    if (reuse) {
      return await this.executeTrackedTurn(input, reuse)
    }
    if (tracked) {
      sessions?.delete(nodeId)
      await this.closeSession(tracked)
    }

    const selector = `id:${workspaceId}`
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

    const caller = { callerKey: `agents-workflow:${runId}` }
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

    const active: ActiveSession = {
      sessionId: created.value.sessionId,
      fence: created.value.fence,
      host,
      caller,
      workspaceId,
      agent: metadata.definition.agent
    }
    const runSessions = sessions ?? new Map<string, ActiveSession>()
    runSessions.set(nodeId, active)
    this.sessionsByRunId.set(runId, runSessions)
    return await this.executeTrackedTurn(input, active)
  }

  /** A node's turn on the chat this run keeps open: the chat stays after the turn ends. */
  private async executeTrackedTurn(
    input: Parameters<AgentsWorkflowStructuredTurnRunner['run']>[0],
    active: ActiveSession
  ) {
    try {
      return await this.executeTurn(active, input.prompt, input.signal)
    } catch (error) {
      if (error instanceof AgentsWorkflowAgentSessionClosedError) {
        return refusal(error.code, error.message, true)
      }
      return refusal(
        input.signal?.aborted ? 'cancelled' : 'structured_agent_turn_failed',
        error instanceof Error ? error.message : String(error),
        !input.signal?.aborted
      )
    }
  }

  /**
   * Stops tracking a finished run. A manual run leaves its chats on screen for the user; a
   * scheduled one reclaims them, since nobody is watching it.
   */
  async release(runId: string, options: { reclaim: boolean }): Promise<void> {
    const sessions = this.sessionsByRunId.get(runId)
    if (!sessions) {
      return
    }
    this.sessionsByRunId.delete(runId)
    if (!options.reclaim) {
      return
    }
    await Promise.all([...sessions.values()].map((session) => this.closeSession(session)))
  }

  async cancel(runId: string): Promise<'stopped' | 'unverifiable'> {
    const sessions = this.sessionsByRunId.get(runId)
    if (!sessions || sessions.size === 0) {
      // Why stopped: no chat was opened yet, so a cancel has nothing to confirm.
      return 'stopped'
    }
    this.sessionsByRunId.delete(runId)
    const active = [...sessions.values()]
    let stopped = true
    for (const session of active) {
      const clientOperationId = createStructuredAgentSessionOperationId(randomUUID)
      const fields = {}
      try {
        await session.host.cancel(session.caller, {
          envelope: {
            sessionId: session.sessionId,
            clientOperationId,
            expectedRuntimeFence: session.fence,
            payloadFingerprint: structuredAgentSessionPayloadFingerprint({
              method: 'agentSession.cancel',
              sessionId: session.sessionId,
              fields
            })
          }
        })
      } catch {
        // Closing still provides the authoritative child-exit observation.
      }
      await this.closeSession(session)
      if (observeStructuredSession(session.sessionId).status !== 'exited') {
        stopped = false
      }
    }
    return stopped ? 'stopped' : 'unverifiable'
  }

  private async closeSession(active: ActiveSession): Promise<void> {
    try {
      await closeStructuredAgentSessionChild(active.sessionId)
    } catch {
      // A finished turn stays authoritative even when background-session cleanup is uncertain.
    }
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
      onSessionDeath: (listener) => active.host.deps.store.onDeathEvidence(listener),
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
