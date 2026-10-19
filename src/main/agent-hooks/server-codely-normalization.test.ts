import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _internals } from './server'
import { buildBody } from './server.test-fixtures'

const { getCohortAtEmitMock, trackMock } = vi.hoisted(() => ({
  getCohortAtEmitMock: vi.fn(),
  trackMock: vi.fn()
}))

vi.mock('../telemetry/client', () => ({
  track: trackMock
}))

vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: getCohortAtEmitMock
}))

beforeEach(() => {
  _internals.resetCachesForTests()
  trackMock.mockReset()
  getCohortAtEmitMock.mockReset()
  getCohortAtEmitMock.mockReturnValue({ nth_repo_added: 2 })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Codely hook normalization', () => {
  it('BeforeTool surfaces toolName + toolInput', () => {
    const result = _internals.normalizeHookPayload(
      'codely',
      buildBody({
        hook_event_name: 'BeforeTool',
        tool_name: 'read_file',
        tool_input: { path: '/src/index.ts' }
      }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
    expect(result?.payload.toolName).toBe('read_file')
    expect(result?.payload.toolInput).toBe('/src/index.ts')
    expect(result?.payload.agentType).toBe('codely')
  })

  it('BeforeAgent clears the cached tool state from a prior turn', () => {
    _internals.normalizeHookPayload(
      'codely',
      buildBody({
        hook_event_name: 'BeforeTool',
        tool_name: 'read_file',
        tool_input: { path: '/stale.ts' }
      }),
      'production'
    )
    const result = _internals.normalizeHookPayload(
      'codely',
      buildBody({ hook_event_name: 'BeforeAgent', prompt: 'fix the flaky test' }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
    expect(result?.payload.prompt).toBe('fix the flaky test')
    expect(result?.payload.toolName).toBeUndefined()
    expect(result?.payload.toolInput).toBeUndefined()
  })

  it('AfterAgent reports done without introducing tool fields on its own', () => {
    const result = _internals.normalizeHookPayload(
      'codely',
      buildBody({ hook_event_name: 'AfterAgent' }),
      'production'
    )
    expect(result?.payload.state).toBe('done')
    expect(result?.payload.toolName).toBeUndefined()
  })

  it('AfterAgent carries prompt_response into lastAssistantMessage', () => {
    const result = _internals.normalizeHookPayload(
      'codely',
      buildBody({
        hook_event_name: 'AfterAgent',
        prompt: 'what did you do',
        prompt_response: 'I ran the tests and they passed.',
        last_assistant_message: 'I ran the tests and they passed.',
        stop_hook_active: false
      }),
      'production'
    )
    expect(result?.payload.state).toBe('done')
    expect(result?.payload.lastAssistantMessage).toBe('I ran the tests and they passed.')
  })

  it('AfterToolFailure keeps the turn working', () => {
    const result = _internals.normalizeHookPayload(
      'codely',
      buildBody({
        hook_event_name: 'AfterToolFailure',
        tool_name: 'run_shell_command'
      }),
      'production'
    )
    expect(result?.payload.state).toBe('working')
  })

  it('a ToolPermission Notification reports waiting without overwriting the turn prompt', () => {
    _internals.normalizeHookPayload(
      'codely',
      buildBody({ hook_event_name: 'BeforeAgent', prompt: 'ship the feature' }),
      'production'
    )
    const result = _internals.normalizeHookPayload(
      'codely',
      buildBody({
        hook_event_name: 'Notification',
        notification_type: 'ToolPermission',
        message: 'Codely needs your approval to run run_shell_command'
      }),
      'production'
    )
    expect(result?.payload.state).toBe('waiting')
    expect(result?.payload.prompt).toBe('ship the feature')
  })

  it('ignores Scheduled notification pings that are not user attention', () => {
    const result = _internals.normalizeHookPayload(
      'codely',
      buildBody({
        hook_event_name: 'Notification',
        notification_type: 'Scheduled'
      }),
      'production'
    )
    expect(result).toBeNull()
  })
})
