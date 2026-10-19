// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsWorkflowPageSurface } from './AgentsWorkflowPageSurface'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'
import type { AgentsWorkflowPageController } from './use-agents-workflow-page-controller'

class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('AgentsWorkflowPageSurface', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('adds an editable agent node', () => {
    const definition = createAgentsWorkflowPageFixture(100)
    const onDefinitionChange = vi.fn()
    render(<AgentsWorkflowPageSurface controller={controller(definition, onDefinitionChange)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))

    expect(onDefinitionChange).toHaveBeenCalledOnce()
    const updated = onDefinitionChange.mock.calls[0]?.[0]
    expect(updated?.nodes).toHaveLength(definition.nodes.length + 1)
    expect(updated?.nodes.at(-1)?.kind).toBe('agent')
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
