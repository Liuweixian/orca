// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentsWorkflowGenerationDraft } from '../../../../shared/agents-workflow-generation'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import { takeAgentsWorkflowGeneratedDraft } from './agents-workflow-generated-drafts'
import { useAgentsWorkflowGenerationRun } from './use-agents-workflow-generation-run'

const mocks = vi.hoisted(
  (): {
    generate: Mock
    toastMessage: Mock
    toastDismiss: Mock
    toastError: Mock
  } => ({
    generate: vi.fn(),
    toastMessage: vi.fn(() => 'designing-toast'),
    toastDismiss: vi.fn(),
    toastError: vi.fn()
  })
)

vi.mock('sonner', () => ({
  toast: {
    message: mocks.toastMessage,
    dismiss: mocks.toastDismiss,
    error: mocks.toastError,
    success: vi.fn()
  }
}))

vi.mock('./agents-workflow-rpc-client', () => ({ generateAgentsWorkflow: mocks.generate }))

const draft: AgentsWorkflowGenerationDraft = {
  name: 'Review changes',
  nodes: [],
  edges: []
}

const request = {
  request: 'Review my changes',
  workspaceId: 'workspace-1',
  agentId: 'claude' as const,
  agentIds: ['claude' as const]
}

beforeEach(() => {
  mocks.generate.mockReset()
  mocks.toastMessage.mockClear()
  mocks.toastDismiss.mockClear()
  mocks.toastError.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('useAgentsWorkflowGenerationRun', () => {
  it('applies the finished design and reports while it runs', async () => {
    mocks.generate.mockResolvedValue({ draft })
    const onApply = vi.fn()
    const { result } = renderHook(() =>
      useAgentsWorkflowGenerationRun({
        definition: createAgentsWorkflowPageFixture(),
        dirty: false,
        onApply,
        onAskReplace: vi.fn()
      })
    )

    act(() => result.current.start(request))

    expect(result.current.generating).toBe(true)
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(draft))
    expect(result.current.generating).toBe(false)
    expect(mocks.toastMessage).toHaveBeenCalledOnce()
    expect(mocks.toastDismiss).toHaveBeenCalledWith('designing-toast')
  })

  // Why ask: the generated graph replaces the whole design, so unsaved edits must not vanish.
  it('asks before replacing a graph with unsaved edits', async () => {
    mocks.generate.mockResolvedValue({ draft })
    const onApply = vi.fn()
    const onAskReplace = vi.fn()
    const { result } = renderHook(() =>
      useAgentsWorkflowGenerationRun({
        definition: createAgentsWorkflowPageFixture(),
        dirty: true,
        onApply,
        onAskReplace
      })
    )

    act(() => result.current.start(request))

    await waitFor(() => expect(onAskReplace).toHaveBeenCalledWith(draft))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('reports a failed design instead of leaving the page waiting', async () => {
    mocks.generate.mockRejectedValue(new Error('The agent did not answer.'))
    const { result } = renderHook(() =>
      useAgentsWorkflowGenerationRun({
        definition: createAgentsWorkflowPageFixture(),
        dirty: false,
        onApply: vi.fn(),
        onAskReplace: vi.fn()
      })
    )

    act(() => result.current.start(request))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('The agent did not answer.'))
    expect(result.current.generating).toBe(false)
  })

  // Why: watching the agent means switching to its chat, which unmounts this page, so the design
  // has to survive the page and reach its workflow when the page comes back.
  it('keeps designing after the page unmounts and holds the draft for its workflow', async () => {
    const definition = createAgentsWorkflowPageFixture()
    let settle: (value: { draft: AgentsWorkflowGenerationDraft }) => void = () => {}
    mocks.generate.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    const onApply = vi.fn()
    const { result, unmount } = renderHook(() =>
      useAgentsWorkflowGenerationRun({
        definition,
        dirty: false,
        onApply,
        onAskReplace: vi.fn()
      })
    )

    act(() => result.current.start(request))
    unmount()
    await act(async () => {
      settle({ draft })
    })

    expect(onApply).not.toHaveBeenCalled()
    expect(takeAgentsWorkflowGeneratedDraft(definition.id)).toEqual(draft)
  })

  // Why: the page is unmounted while the user watches the agent, so coming back must not start a
  // second design for the same workflow — two turns would race and overwrite each other's graph.
  it('does not start a second design for the same workflow after a remount', async () => {
    const definition = createAgentsWorkflowPageFixture()
    let settle: (value: { draft: AgentsWorkflowGenerationDraft }) => void = () => {}
    mocks.generate.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    const first = renderHook(() =>
      useAgentsWorkflowGenerationRun({
        definition,
        dirty: false,
        onApply: vi.fn(),
        onAskReplace: vi.fn()
      })
    )

    act(() => first.result.current.start(request))
    expect(first.result.current.generating).toBe(true)
    first.unmount()

    const second = renderHook(() =>
      useAgentsWorkflowGenerationRun({
        definition,
        dirty: false,
        onApply: vi.fn(),
        onAskReplace: vi.fn()
      })
    )
    expect(second.result.current.generating).toBe(true)

    act(() => second.result.current.start(request))
    expect(mocks.generate).toHaveBeenCalledOnce()

    await act(async () => {
      settle({ draft })
    })
    expect(second.result.current.generating).toBe(false)
  })
})
