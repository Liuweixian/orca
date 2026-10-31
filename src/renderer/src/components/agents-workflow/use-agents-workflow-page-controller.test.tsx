// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { AGENTS_WORKFLOW_REVISION_CONFLICT } from '../../../../shared/agents-workflow-errors'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import { useAgentsWorkflowPageController } from './use-agents-workflow-page-controller'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const rpc = vi.hoisted(() => ({
  listAgentsWorkflows: vi.fn(),
  showAgentsWorkflow: vi.fn(),
  createAgentsWorkflow: vi.fn(),
  updateAgentsWorkflow: vi.fn(),
  deleteAgentsWorkflow: vi.fn(),
  listAgentsWorkflowRuns: vi.fn(),
  showAgentsWorkflowRun: vi.fn(),
  cancelAgentsWorkflowRun: vi.fn(),
  clearAgentsWorkflowRuns: vi.fn()
}))

vi.mock('./agents-workflow-rpc-client', () => rpc)
vi.mock('./agents-workflow-run-start', () => ({ runAgentsWorkflowWithToast: vi.fn() }))
vi.mock('./use-agents-workflow-agent-channels', () => ({
  useAgentsWorkflowAgentChannels: () => null
}))
vi.mock('./use-agents-workflow-invalidation', () => ({
  useAgentsWorkflowInvalidation: () => {}
}))

const initialState = useAppStore.getInitialState()

function workflow(id: string): ReturnType<typeof createAgentsWorkflowPageFixture> {
  return { ...createAgentsWorkflowPageFixture(), id, name: `Workflow ${id}` }
}

beforeEach(() => {
  rpc.listAgentsWorkflows.mockResolvedValue([workflow('first'), workflow('second')])
  rpc.showAgentsWorkflow.mockImplementation(async (id: string) => workflow(id))
  rpc.listAgentsWorkflowRuns.mockResolvedValue({ runs: [], nextCursor: null })
  useAppStore.setState({ pendingAgentsWorkflowDefinitionId: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useAppStore.setState(initialState, true)
})

describe('useAgentsWorkflowPageController initial selection', () => {
  it('opens the workflow another surface requested instead of the first one', async () => {
    useAppStore.setState({ pendingAgentsWorkflowDefinitionId: 'second' })

    const { result } = renderHook(() => useAgentsWorkflowPageController())

    await waitFor(() => expect(result.current.definition?.id).toBe('second'))
    expect(rpc.showAgentsWorkflow).toHaveBeenCalledWith('second')
    expect(useAppStore.getState().pendingAgentsWorkflowDefinitionId).toBeNull()
  })

  it('falls back to the first workflow when nothing was requested', async () => {
    const { result } = renderHook(() => useAgentsWorkflowPageController())

    await waitFor(() => expect(result.current.definition?.id).toBe('first'))
    expect(rpc.showAgentsWorkflow).toHaveBeenCalledOnce()
  })

  it('falls back to the first workflow when the requested one is gone', async () => {
    useAppStore.setState({ pendingAgentsWorkflowDefinitionId: 'deleted' })

    const { result } = renderHook(() => useAgentsWorkflowPageController())

    await waitFor(() => expect(result.current.definition?.id).toBe('first'))
  })

  it('stops loading when no workflow exists', async () => {
    rpc.listAgentsWorkflows.mockResolvedValue([])

    const { result } = renderHook(() => useAgentsWorkflowPageController())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.definition).toBeNull()
  })
})

describe('useAgentsWorkflowPageController applyAndSaveWorkflow', () => {
  it('saves the definition it is handed, not the one on screen', async () => {
    const { result } = renderHook(() => useAgentsWorkflowPageController())
    await waitFor(() => expect(result.current.definition?.id).toBe('first'))

    // Why a separate object: a generated graph never passes through setDefinition first.
    const generated = { ...workflow('first'), name: 'Generated' }
    const saved = { ...generated, revision: 2 }
    rpc.updateAgentsWorkflow.mockResolvedValue(saved)

    await act(async () => {
      await result.current.applyAndSaveWorkflow(generated)
    })

    expect(rpc.updateAgentsWorkflow).toHaveBeenCalledWith(
      'first',
      1,
      expect.objectContaining({ name: 'Generated', nodes: generated.nodes })
    )
    expect(result.current.definition).toBe(saved)
    expect(result.current.dirty).toBe(false)
  })

  it('keeps the generated graph on the canvas when the save conflicts', async () => {
    const { result } = renderHook(() => useAgentsWorkflowPageController())
    await waitFor(() => expect(result.current.definition?.id).toBe('first'))

    const generated = { ...workflow('first'), name: 'Generated' }
    rpc.updateAgentsWorkflow.mockRejectedValue(
      new RuntimeRpcCallError({
        id: 'rpc-1',
        ok: false,
        error: { code: AGENTS_WORKFLOW_REVISION_CONFLICT, message: 'conflict' }
      })
    )

    await act(async () => {
      await result.current.applyAndSaveWorkflow(generated)
    })

    expect(result.current.conflict).toBe(true)
    expect(result.current.definition).toBe(generated)
    expect(result.current.dirty).toBe(true)
  })
})
