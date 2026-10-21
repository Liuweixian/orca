// Reading a turn's answer back from the agent's own transcript.
//
// The agent writes the transcript; Orca only reads it. A session is matched by its working
// directory and, when the agent records it, the exact prompt this run sent — a wrong match would
// hand the next node someone else's words, so an uncertain match is "unavailable", never a guess.

import { stat } from 'node:fs/promises'
import { normalize, sep } from 'node:path'
import type { AiVaultAgent, AiVaultSession } from '../../shared/ai-vault-types'
import { scanAiVaultSessions } from '../ai-vault/session-scanner'
import { parseAgentSessionFile } from '../ai-vault/session-scanner-agent-parser'
import type { SessionFileCandidate } from '../ai-vault/session-scanner-types'
import type { TranscriptMessageSink } from '../ai-vault/session-transcript-consumers'
import { AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES } from './structured-agent-output-capture'

/** A transcript may be written a moment after the pane settled, and clocks drift slightly. */
const TRANSCRIPT_CLOCK_SLACK_MS = 60_000
const TRANSCRIPT_SCAN_LIMIT = 20
const TRANSCRIPT_SCAN_LIMIT_PER_AGENT = 4

export type WorkflowTranscriptTurn =
  | {
      ok: true
      content: string
      /** The session this turn consumed; never matched again. */ sessionPath: string
    }
  | { ok: false; message: string }

function comparablePath(path: string | null): string | null {
  if (!path) {
    return null
  }
  const normalized = normalize(path)
  const trimmed =
    normalized.length > 1 && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

function modifiedAtMs(session: AiVaultSession): number {
  const parsed = Date.parse(session.modifiedAt || session.updatedAt || '')
  return Number.isNaN(parsed) ? 0 : parsed
}

function pickSession(
  sessions: readonly AiVaultSession[],
  workspacePath: string,
  prompt: string,
  startedAt: number,
  claimedSessionPaths: ReadonlySet<string>
): AiVaultSession | null {
  const cwd = comparablePath(workspacePath)
  const inWorkspace = sessions.filter(
    (session) =>
      comparablePath(session.cwd) === cwd &&
      !claimedSessionPaths.has(comparablePath(session.filePath) ?? '')
  )
  if (inWorkspace.length === 0) {
    return null
  }
  const since = startedAt - TRANSCRIPT_CLOCK_SLACK_MS
  const target = prompt.trim()
  // Why no time-based fallback: another session in this workspace (the user's own chat, or a
  // parallel node of this workflow) would be indistinguishable, and handing its answer downstream
  // is worse than falling through to the file contract. Only an exact prompt match counts; the
  // time bound keeps an older run of the same prompt from answering this one. The newest match
  // wins, because a loop iteration repeating the same prompt leaves the earlier session in range.
  return (
    inWorkspace
      .filter(
        (session) => session.lastUserPrompt?.trim() === target && modifiedAtMs(session) >= since
      )
      .sort((left, right) => modifiedAtMs(right) - modifiedAtMs(left))[0] ?? null
  )
}

async function sessionCandidate(session: AiVaultSession): Promise<SessionFileCandidate> {
  let sizeBytes: number | undefined
  try {
    sizeBytes = (await stat(session.filePath)).size
  } catch {
    // Synthetic candidates (OpenCode SQLite rows) have no file to stat; the parsers that read
    // them do not need a size.
  }
  return {
    agent: session.agent,
    file: {
      path: session.filePath,
      mtimeMs: modifiedAtMs(session),
      modifiedAt: session.modifiedAt,
      ...(sizeBytes === undefined ? {} : { sizeBytes })
    },
    codexHome: session.codexHome ?? null
  }
}

/**
 * The full assistant text of the matched turn. The scanner's preview messages are truncated to a
 * display width, so a value must come from the transcript itself, not from that cache.
 */
async function readAssistantAnswer(
  session: AiVaultSession,
  since: number,
  signal?: AbortSignal
): Promise<string | null> {
  const messages: { text: string; timestamp: string | null }[] = []
  const sink: TranscriptMessageSink = {
    active: true,
    push: (message) => {
      if (message.role === 'assistant' && message.text.trim()) {
        messages.push({ text: message.text, timestamp: message.timestamp })
      }
    }
  }
  const parsed = await parseAgentSessionFile(
    await sessionCandidate(session),
    session.executionHostPlatform ?? process.platform,
    sink,
    signal
  )
  if (!parsed) {
    return null
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const at = message.timestamp ? Date.parse(message.timestamp) : Number.NaN
    // A message with no timestamp is still the session's latest answer; the session itself was
    // matched by prompt and touched after the turn began.
    if (!Number.isNaN(at) && at < since) {
      continue
    }
    return message.text
  }
  return null
}

/** The answer this turn wrote, read back from `agent`'s transcript. */
export async function readWorkflowTranscriptTurn(input: {
  agent: AiVaultAgent
  workspacePath: string
  prompt: string
  startedAt: number
  signal?: AbortSignal
  /** Sessions another turn of this run already consumed. */
  claimedSessionPaths?: readonly string[]
}): Promise<WorkflowTranscriptTurn> {
  let result: Awaited<ReturnType<typeof scanAiVaultSessions>>
  try {
    result = await scanAiVaultSessions({
      scopePaths: [input.workspacePath],
      limit: TRANSCRIPT_SCAN_LIMIT,
      limitPerAgent: TRANSCRIPT_SCAN_LIMIT_PER_AGENT,
      ...(input.signal ? { signal: input.signal } : {})
    })
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The agent transcript could not be read.'
    }
  }

  const session = pickSession(
    result.sessions.filter((candidate) => candidate.agent === input.agent),
    input.workspacePath,
    input.prompt,
    input.startedAt,
    new Set((input.claimedSessionPaths ?? []).map((path) => comparablePath(path) ?? ''))
  )
  if (!session) {
    return { ok: false, message: 'No transcript session matched this turn.' }
  }
  let content: string | null
  try {
    content = await readAssistantAnswer(
      session,
      input.startedAt - TRANSCRIPT_CLOCK_SLACK_MS,
      input.signal
    )
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'The agent transcript could not be read.'
    }
  }
  if (content === null) {
    return { ok: false, message: 'The transcript has no assistant answer for this turn.' }
  }
  if (Buffer.byteLength(content, 'utf8') > AGENTS_WORKFLOW_NODE_OUTPUT_LIMIT_BYTES) {
    return { ok: false, message: 'The transcript answer is larger than a workflow value may be.' }
  }
  return { ok: true, content, sessionPath: session.filePath }
}
