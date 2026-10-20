// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AgentsWorkflowPageSurface } from './AgentsWorkflowPageSurface'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import type { AgentsWorkflowPageController } from './use-agents-workflow-page-controller'

const mocks = vi.hoisted((): { toastError: Mock; writeClipboardText: Mock } => ({
  toastError: vi.fn(),
  writeClipboardText: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn() }
}))

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('AgentsWorkflowPageSurface', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    mocks.toastError.mockReset()
    mocks.writeClipboardText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText: mocks.writeClipboardText } }
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('copies the workflow JSON through the app clipboard bridge', async () => {
    const definition = createAgentsWorkflowPageFixture(100)
    render(<AgentsWorkflowPageSurface controller={controller(definition, vi.fn())} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))

    await waitFor(() => expect(mocks.writeClipboardText).toHaveBeenCalledOnce())
    expect(mocks.writeClipboardText).toHaveBeenCalledWith(JSON.stringify(definition, null, 2))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('reports a failed copy when the bridge rejects', async () => {
    const definition = createAgentsWorkflowPageFixture(100)
    mocks.writeClipboardText.mockRejectedValue(new Error('Clipboard is unavailable.'))
    render(<AgentsWorkflowPageSurface controller={controller(definition, vi.fn())} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('Could not copy workflow JSON.')
    )
  })

  it('adds an editable agent node', () => {
    const definition = createAgentsWorkflowPageFixture(100)
    const onDefinitionChange = vi.fn()
    render(<AgentsWorkflowPageSurface controller={controller(definition, onDefinitionChange)} />)

    fireEvent.contextMenu(screen.getByRole('application'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agent' }))

    expect(onDefinitionChange).toHaveBeenCalledOnce()
    const updated = onDefinitionChange.mock.calls[0]?.[0]
    expect(updated?.nodes).toHaveLength(definition.nodes.length + 1)
    expect(updated?.nodes.at(-1)?.kind).toBe('agent')
  })

  it('deletes a node and its edges from the node context menu', () => {
    const definition = createAgentsWorkflowPageFixture(100)
    const onDefinitionChange = vi.fn()
    const { container } = render(
      <AgentsWorkflowPageSurface controller={controller(definition, onDefinitionChange)} />
    )

    const researchNode = container.querySelector('.react-flow__node[data-id="research"]')
    expect(researchNode).not.toBeNull()
    if (!researchNode) {
      return
    }

    fireEvent.contextMenu(researchNode)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete node' }))

    expect(onDefinitionChange).toHaveBeenCalledOnce()
    const updated = onDefinitionChange.mock.calls[0]?.[0]
    expect(updated?.nodes.map((node: { id: string }) => node.id)).toEqual(['start', 'publish'])
    expect(updated?.edges).toHaveLength(0)
  })

  it('does not offer a working delete for the start node', () => {
    const definition = createAgentsWorkflowPageFixture(100)
    const onDefinitionChange = vi.fn()
    const { container } = render(
      <AgentsWorkflowPageSurface controller={controller(definition, onDefinitionChange)} />
    )

    const startNode = container.querySelector('.react-flow__node[data-id="start"]')
    expect(startNode).not.toBeNull()
    if (!startNode) {
      return
    }

    fireEvent.contextMenu(startNode)
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete node' })
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(deleteItem)

    expect(onDefinitionChange).not.toHaveBeenCalled()
  })

  it('enables an RRULE schedule from workflow settings', () => {
    const definition = createAgentsWorkflowPageFixture(100)
    const onDefinitionChange = vi.fn()
    render(<AgentsWorkflowPageSurface controller={controller(definition, onDefinitionChange)} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Scheduled runs' }))

    const updated = onDefinitionChange.mock.calls[0]?.[0]
    expect(updated?.trigger.schedule?.rrule).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=0')
  })
})

function controller(
  definition: ReturnType<typeof createAgentsWorkflowPageFixture>,
  setDefinition: AgentsWorkflowPageController['setDefinition']
): AgentsWorkflowPageController {
  return {
    workflows: [definition],
    definition,
    runs: [],
    selectedRun: null,
    nextRunsCursor: null,
    loading: false,
    saving: false,
    running: false,
    dirty: true,
    conflict: false,
    runInput: '',
    setDefinition,
    setRunInput: vi.fn(),
    selectWorkflow: vi.fn(async () => undefined),
    createWorkflow: vi.fn(async () => undefined),
    saveWorkflow: vi.fn(async () => undefined),
    deleteWorkflow: vi.fn(async () => undefined),
    runNow: vi.fn(async () => undefined),
    cancelRun: vi.fn(async () => undefined),
    selectRun: vi.fn(async () => undefined),
    loadMoreRuns: vi.fn(async () => undefined),
    reloadAfterConflict: vi.fn(async () => undefined)
  }
}
