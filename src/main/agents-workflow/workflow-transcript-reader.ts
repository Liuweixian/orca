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

/**
 * A prompt as it can be compared across the two sides that record it: our assembled prompt and
 * the agent's `lastUserPrompt`. Line endings and runs of whitespace differ between what a CLI is
 * handed and what it writes back, and a trailing newline was enough to lose the whole turn.
 */
function normalizePrompt(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** Short prefixes are the shared boilerplate every node prompt carries, and prove nothing. */
const PROMPT_PREFIX_MATCH_MIN_LENGTH = 120

type SessionMatch =
  | { session: AiVaultSession }
  | { session: null; workspaceSessions: number; recentSessions: number }

function pickSession(
  sessions: readonly AiVaultSession[],
  workspacePath: string,
  prompt: string,
  startedAt: number,
  claimedSessionPaths: ReadonlySet<string>
): SessionMatch {
  const cwd = comparablePath(workspacePath)
  const inWorkspace = sessions.filter(
    (session) =>
      comparablePath(session.cwd) === cwd &&
      !claimedSessionPaths.has(comparablePath(session.filePath) ?? '')
  )
  if (inWorkspace.length === 0) {
    return { session: null, workspaceSessions: 0, recentSessions: 0 }
  }
  const since = startedAt - TRANSCRIPT_CLOCK_SLACK_MS
  const recent = inWorkspace.filter((session) => modifiedAtMs(session) >= since)
  const target = normalizePrompt(prompt)
  // Why no time-only fallback: another session in this workspace (the user's own chat, or a
  // parallel node of this workflow) would be indistinguishable, and handing its answer downstream
  // is worse than falling through to the file contract. Only a prompt match counts; the time bound
  // keeps an older run of the same prompt from answering this one. The newest match wins, because
  // a loop iteration repeating the same prompt leaves the earlier session in range.
  const normalized = (session: AiVaultSession): string => normalizePrompt(session.lastUserPrompt)
  const exact = recent.filter((session) => normalized(session) === target)
  if (exact.length > 0) {
    return { session: newest(exact) }
  }
  // Why a second chance: an agent may record the prompt with only its own wrapper trimmed. It is
  // accepted only when one candidate qualifies, and only for a prompt long enough that the shared
  // prefix is not the whole match.
  if (target.length >= PROMPT_PREFIX_MATCH_MIN_LENGTH) {
    const prefix = recent.filter((session) => {
      const recorded = normalized(session)
      return (
        recorded.length >= PROMPT_PREFIX_MATCH_MIN_LENGTH &&
        (recorded.startsWith(target) || target.startsWith(recorded))
      )
    })
    if (prefix.length === 1) {
      return { session: prefix[0] }
    }
  }
  return { session: null, workspaceSessions: inWorkspace.length, recentSessions: recent.length }
}

function newest(sessions: readonly AiVaultSession[]): AiVaultSession {
  return [...sessions].sort((left, right) => modifiedAtMs(right) - modifiedAtMs(left))[0]
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

/** Why the counts: "no session matched" gave the user nothing to act on. */
function noMatchMessage(match: { workspaceSessions: number; recentSessions: number }): string {
  if (match.workspaceSessions === 0) {
    return 'No transcript session ran in this workspace for this turn.'
  }
  return `No transcript session matched this turn's prompt (${match.workspaceSessions} session(s) in the workspace, ${match.recentSessions} touched since the turn began).`
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

  const match = pickSession(
    result.sessions.filter((candidate) => candidate.agent === input.agent),
    input.workspacePath,
    input.prompt,
    input.startedAt,
    new Set((input.claimedSessionPaths ?? []).map((path) => comparablePath(path) ?? ''))
  )
  const session = match.session
  if (!session) {
    return { ok: false, message: noMatchMessage(match) }
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
