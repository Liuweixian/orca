import type { AgentSessionTurnCompletion } from '../../shared/agent-session-turn-completion-wire'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'

type CompletionHost = Pick<StructuredAgentSessionHost, 'subscribeTurnCompletions'>

export async function waitStructuredAgentTurnCompletion<T>(input: {
  host: CompletionHost
  sessionId: string
  subscriberId: string
  send: () => Promise<T>
  signal?: AbortSignal
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
  const onAbort = (): void => rejectCompletion(input.signal?.reason)
  input.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const sent = await input.send()
    return { sent, completion: await completion }
  } finally {
    input.signal?.removeEventListener('abort', onAbort)
    unsubscribe()
  }
}
