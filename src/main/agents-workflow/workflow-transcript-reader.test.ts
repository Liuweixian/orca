import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { TranscriptMessage } from '../ai-vault/session-transcript-consumers'
import { readWorkflowTranscriptTurn } from './workflow-transcript-reader'

const scanner = vi.hoisted(() => ({ scanAiVaultSessions: vi.fn() }))
const parser = vi.hoisted(() => ({ parseAgentSessionFile: vi.fn() }))

vi.mock('../ai-vault/session-scanner', () => ({
  scanAiVaultSessions: scanner.scanAiVaultSessions
}))

vi.mock('../ai-vault/session-scanner-agent-parser', () => ({
  parseAgentSessionFile: parser.parseAgentSessionFile
}))

function session(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'session-1',
    executionHostId: 'local',
    agent: 'gemini',
    sessionId: 'session-1',
    title: 'Workflow',
    cwd: '/repo/worktree',
    branch: null,
    model: null,
    filePath: '/home/.gemini/session-1.json',
    codexHome: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:05.000Z',
    modifiedAt: '2026-10-20T10:00:05.000Z',
    messageCount: 2,
    totalTokens: 0,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: '',
    subagent: null,
    ...overrides
  }
}

function scanResult(sessions: AiVaultSession[]) {
  return { sessions, issues: [], scannedAt: '2026-10-20T10:00:06.000Z' }
}

function transcript(messages: TranscriptMessage[]) {
  return (
    _candidate: unknown,
    _platform: unknown,
    sink: { push(message: TranscriptMessage): void }
  ) => {
    for (const message of messages) {
      sink.push(message)
    }
    return Promise.resolve({})
  }
}

const STARTED_AT = Date.parse('2026-10-20T10:00:00.000Z')

beforeEach(() => {
  scanner.scanAiVaultSessions.mockReset()
  parser.parseAgentSessionFile.mockReset()
})

describe('readWorkflowTranscriptTurn', () => {
  it('reads the assistant answer of the session whose prompt matches', async () => {
    scanner.scanAiVaultSessions.mockResolvedValue(
      scanResult([session({ lastUserPrompt: 'review the diff' })])
    )
    parser.parseAgentSessionFile.mockImplementation(
      transcript([
        { role: 'user', text: 'review the diff', timestamp: '2026-10-20T10:00:01.000Z' },
        { role: 'assistant', text: 'looks good', timestamp: '2026-10-20T10:00:04.000Z' }
      ])
    )

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toEqual({ ok: true, content: 'looks good' })
  })

  it('returns the full answer instead of the scanner preview', async () => {
    scanner.scanAiVaultSessions.mockResolvedValue(
      scanResult([
        session({
          lastUserPrompt: 'review the diff',
          previewMessages: [
            {
              role: 'assistant',
              text: 'x'.repeat(220),
              timestamp: '2026-10-20T10:00:04.000Z'
            }
          ]
        })
      ])
    )
    const long = 'y'.repeat(5_000)
    parser.parseAgentSessionFile.mockImplementation(
      transcript([{ role: 'assistant', text: long, timestamp: '2026-10-20T10:00:04.000Z' }])
    )

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toEqual({ ok: true, content: long })
  })

  it('ignores a session in another working directory', async () => {
    scanner.scanAiVaultSessions.mockResolvedValue(
      scanResult([session({ cwd: '/repo/other', lastUserPrompt: 'review the diff' })])
    )

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toMatchObject({ ok: false })
    expect(parser.parseAgentSessionFile).not.toHaveBeenCalled()
  })

  it('refuses rather than guessing when no session recorded this prompt', async () => {
    scanner.scanAiVaultSessions.mockResolvedValue(
      scanResult([
        session({
          id: 'session-2',
          lastUserPrompt: null,
          modifiedAt: '2026-10-20T10:00:03.000Z'
        })
      ])
    )

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toEqual({ ok: false, message: 'No transcript session matched this turn.' })
    expect(parser.parseAgentSessionFile).not.toHaveBeenCalled()
  })

  it('matches a workspace path written with a trailing separator', async () => {
    scanner.scanAiVaultSessions.mockResolvedValue(
      scanResult([session({ cwd: '/repo/worktree/', lastUserPrompt: 'review the diff' })])
    )
    parser.parseAgentSessionFile.mockImplementation(
      transcript([{ role: 'assistant', text: 'ok', timestamp: '2026-10-20T10:00:04.000Z' }])
    )

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toEqual({ ok: true, content: 'ok' })
  })

  it('refuses when the matched session has no assistant answer yet', async () => {
    scanner.scanAiVaultSessions.mockResolvedValue(
      scanResult([session({ lastUserPrompt: 'review the diff' })])
    )
    parser.parseAgentSessionFile.mockImplementation(
      transcript([{ role: 'user', text: 'review the diff', timestamp: null }])
    )

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining('assistant') })
  })

  it('ignores an assistant answer written before this turn', async () => {
    scanner.scanAiVaultSessions.mockResolvedValue(
      scanResult([session({ lastUserPrompt: 'review the diff' })])
    )
    parser.parseAgentSessionFile.mockImplementation(
      transcript([
        { role: 'assistant', text: 'the old answer', timestamp: '2026-10-20T09:00:00.000Z' }
      ])
    )

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining('assistant') })
  })

  it('refuses when the scan itself fails', async () => {
    scanner.scanAiVaultSessions.mockRejectedValue(new Error('scan exploded'))

    await expect(
      readWorkflowTranscriptTurn({
        agent: 'gemini',
        workspacePath: '/repo/worktree',
        prompt: 'review the diff',
        startedAt: STARTED_AT
      })
    ).resolves.toEqual({ ok: false, message: 'scan exploded' })
  })
})
