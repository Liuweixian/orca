import { describe, expect, it, vi } from 'vitest'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import type { AgentsWorkflowStructuredTurnRunner } from './workflow-agent-execution-adapter'
import { createAgentsWorkflowExecutionAdapter } from './workflow-agent-execution-adapter'
import type { AgentsWorkflowFileHandoffTurnRunner } from './workflow-file-handoff-runner'
import type { AgentsWorkflowTranscriptTurnRunner } from './workflow-transcript-turn-runner'
import type { AgentsWorkflowReportTurnRunner } from './workflow-report-turn-runner'

type AgentNode = Extract<AgentsWorkflowDefinition['nodes'][number], { kind: 'agent' }>

function node(agentId: AgentNode['agentId']): AgentNode {
  return {
    id: 'agent-1',
    kind: 'agent',
    title: 'Agent',
    position: { x: 0, y: 0 },
    agentId,
    prompt: { source: 'work' },
    terminal: false
  }
}

function runner(): AgentsWorkflowStructuredTurnRunner {
  return {
    run: vi.fn(async () => ({
      ok: false as const,
      code: 'structured_agent_unsupported',
      message: 'no structured session'
    })),
    cancel: vi.fn(async () => 'stopped' as const),
    release: vi.fn(async () => undefined)
  }
}

function fileRunner(): AgentsWorkflowFileHandoffTurnRunner {
  return {
    run: vi.fn(async () => ({
      ok: true as const,
      output: {
        format: 'plain_text' as const,
        content: 'from the file',
        capturedAt: 1,
        truncated: false,
        source: 'agent_file_handoff' as const
      }
    })),
    cancel: vi.fn(async () => 'stopped' as const),
    release: vi.fn(async () => undefined)
  }
}

function reportRunner(): AgentsWorkflowReportTurnRunner {
  return {
    run: vi.fn(async () => ({
      ok: true as const,
      output: {
        format: 'plain_text' as const,
        content: 'pane text',
        capturedAt: 1,
        truncated: true,
        source: 'terminal_snapshot' as const
      }
    })),
    cancel: vi.fn(async () => 'stopped' as const),
    release: vi.fn(async () => undefined)
  }
}

function transcriptRunner(): AgentsWorkflowTranscriptTurnRunner {
  return {
    run: vi.fn(async () => ({
      ok: true as const,
      output: {
        format: 'plain_text' as const,
        content: 'from the transcript',
        capturedAt: 1,
        truncated: false,
        source: 'agent_transcript' as const
      }
    })),
    cancel: vi.fn(async () => 'stopped' as const),
    release: vi.fn(async () => undefined)
  }
}

describe('agents workflow execution adapter', () => {
  it('refuses an agent that has no protocol channel instead of guessing', async () => {
    const structured = runner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      node: node('aider'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: false, code: 'agent_channel_unavailable' })
    expect(structured.run).not.toHaveBeenCalled()
  })

  it('runs a protocol agent on the structured runner and reports its refusal', async () => {
    const structured = runner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      node: node('claude'),
      prompt: 'work'
    })

    expect(structured.run).toHaveBeenCalledOnce()
    // Nothing else is wired here, so the run reports the missing channel rather than the
    // capability refusal it fell through.
    expect(result).toMatchObject({ ok: false, code: 'agent_channel_unavailable' })
  })

  it('falls through to the file channel when no structured session can open', async () => {
    const structured = runner()
    const file = fileRunner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node('claude'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { source: 'agent_file_handoff' } })
    expect(file.run).toHaveBeenCalledOnce()
  })

  it('does not fall through when the structured turn itself failed', async () => {
    const structured = runner()
    structured.run = vi.fn(async () => ({
      ok: false as const,
      code: 'structured_output_missing',
      message: 'no assistant message'
    }))
    const file = fileRunner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node('claude'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: false, code: 'structured_output_missing' })
    expect(file.run).not.toHaveBeenCalled()
  })

  it('runs an agent with no protocol channel on the file channel', async () => {
    const structured = runner()
    const file = fileRunner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node('aider'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { source: 'agent_file_handoff' } })
    expect(structured.run).not.toHaveBeenCalled()
  })

  it('takes the transcript before the file for a transcript agent', async () => {
    const structured = runner()
    const file = fileRunner()
    const transcript = transcriptRunner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file, transcript)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node('gemini'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { source: 'agent_transcript' } })
    expect(transcript.run).toHaveBeenCalledOnce()
    expect(file.run).not.toHaveBeenCalled()
  })

  it('does not re-run a finished transcript turn through the file channel', async () => {
    const structured = runner()
    const file = fileRunner()
    const transcript = transcriptRunner()
    transcript.run = vi.fn(async () => ({
      ok: false as const,
      code: 'transcript_turn_unavailable',
      message: 'no session matched'
    }))
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file, transcript)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node('gemini'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: false, code: 'transcript_turn_unavailable' })
    expect(file.run).not.toHaveBeenCalled()
  })

  it('falls to the file channel when the transcript channel cannot run at all', async () => {
    const structured = runner()
    const file = fileRunner()
    const transcript = transcriptRunner()
    transcript.run = vi.fn(async () => ({
      ok: false as const,
      code: 'transcript_channel_unavailable',
      message: 'this build cannot read that transcript'
    }))
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file, transcript)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node('gemini'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { source: 'agent_file_handoff' } })
    expect(file.run).toHaveBeenCalledOnce()
  })

  it('walks protocol, transcript and file in registry order', async () => {
    const structured = runner()
    structured.run = vi.fn(async () => ({
      ok: false as const,
      code: 'structured_agent_unsupported',
      message: 'old cli'
    }))
    const transcript = transcriptRunner()
    const file = fileRunner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file, transcript)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: node('claude'),
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { source: 'agent_transcript' } })
    expect(structured.run).toHaveBeenCalledOnce()
    expect(transcript.run).toHaveBeenCalledOnce()
    expect(file.run).not.toHaveBeenCalled()
  })

  it('never puts an output contract on a terminal node, even on a file-only agent', async () => {
    const structured = runner()
    const file = fileRunner()
    const transcript = transcriptRunner()
    const report = reportRunner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file, transcript, report)
    const terminal = { ...node('aider'), terminal: true }

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: terminal,
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: true, output: { source: 'terminal_snapshot' } })
    expect(report.run).toHaveBeenCalledOnce()
    expect(file.run).not.toHaveBeenCalled()
  })

  it('still prefers the structured channel for a terminal node that has one', async () => {
    const structured = runner()
    structured.run = vi.fn(async () => ({
      ok: false as const,
      code: 'structured_output_missing',
      message: 'no assistant message'
    }))
    const file = fileRunner()
    const transcript = transcriptRunner()
    const report = reportRunner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured, file, transcript, report)

    const result = await adapter.execute({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: '/repo',
      node: { ...node('claude'), terminal: true },
      prompt: 'work'
    })

    expect(result).toMatchObject({ ok: false, code: 'structured_output_missing' })
    expect(transcript.run).not.toHaveBeenCalled()
    expect(report.run).not.toHaveBeenCalled()
  })

  it('reaches the runner that owns the run for both cancel and release', async () => {
    const structured = runner()
    const adapter = createAgentsWorkflowExecutionAdapter(structured)

    await expect(adapter.cancel('run-1')).resolves.toBe('stopped')
    await adapter.release?.('run-1', { reclaim: true })

    expect(structured.cancel).toHaveBeenCalledWith('run-1')
    expect(structured.release).toHaveBeenCalledWith('run-1', { reclaim: true })
  })
})
