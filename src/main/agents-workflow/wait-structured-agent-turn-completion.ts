import type { AgentSessionTurnCompletion } from '../../shared/agent-session-turn-completion-wire'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'

type CompletionHost = Pick<StructuredAgentSessionHost, 'subscribeTurnCompletions'>

/** The chat this node was driving went away, so no turn completion can ever arrive for it. */
const AGENT_SESSION_CLOSED_CODE = 'agent_session_closed'

export class AgentsWorkflowAgentSessionClosedError extends Error {
  readonly code = AGENT_SESSION_CLOSED_CODE

  constructor() {
    super('The agent chat running this node was closed before its turn completed.')
    this.name = 'AgentsWorkflowAgentSessionClosedError'
  }
}

export async function waitStructuredAgentTurnCompletion<T>(input: {
  host: CompletionHost
  sessionId: string
  subscriberId: string
  send: () => Promise<T>
  signal?: AbortSignal
  /**
   * Told once this session's provider death is committed. Why: completion is live-only, so a chat
   * closed mid-turn publishes no event and the wait would hold the run's workspace lock until the
   * run budget expired.
   */
  onSessionDeath?: (listener: (sessionId: string) => void) => () => void
}): Promise<{ sent: T; completion: AgentSessionTurnCompletion }> {
  if (input.signal?.aborted) {
    throw input.signal.reason
  }

  let resolveCompletion: (completion: AgentSessionTurnCompletion) => void = () => undefined
  let rejectCompletion: (error: unknown) => void = () => undefined
  const completion = new Promise<AgentSessionTurnCompletion>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })
  const unsubscribe = input.host.subscribeTurnCompletions({
    id: input.subscriberId,
    emit: (event) => {
      if (event.type === 'completion' && event.completion.sessionId === input.sessionId) {
        resolveCompletion(event.completion)
      } else if (event.type === 'end') {
        rejectCompletion(new Error('Structured turn completion subscription ended.'))
      }
    }
  })
  // Why not on an aborted signal: a cancel closes the chat too, and the user's stop must decide
  // the run's outcome rather than this half seeing the death first.
  const unwatchDeath = input.onSessionDeath?.((endedSessionId) => {
    if (endedSessionId === input.sessionId && input.signal?.aborted !== true) {
      rejectCompletion(new AgentsWorkflowAgentSessionClosedError())
    }
  })
  const onAbort = (): void => rejectCompletion(input.signal?.reason)
  input.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const sent = await input.send()
    return { sent, completion: await completion }
  } finally {
    input.signal?.removeEventListener('abort', onAbort)
    unwatchDeath?.()
    unsubscribe()
  }
}
