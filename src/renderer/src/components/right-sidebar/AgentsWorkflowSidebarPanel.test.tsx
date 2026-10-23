// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import { createAgentsWorkflowPageFixture } from '../agents-workflow/agents-workflow-page-fixtures'
import AgentsWorkflowSidebarPanel from './AgentsWorkflowSidebarPanel'

const { listAgentsWorkflows } = vi.hoisted(() => ({ listAgentsWorkflows: vi.fn() }))
vi.mock('../agents-workflow/agents-workflow-rpc-client', () => ({ listAgentsWorkflows }))
vi.mock('../agents-workflow/use-agents-workflow-invalidation', () => ({
  useAgentsWorkflowInvalidation: () => {}
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name]))
      : fallback
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const initialState = useAppStore.getInitialState()

function validWorkflow(): ReturnType<typeof createAgentsWorkflowPageFixture> {
  return { ...createAgentsWorkflowPageFixture(), id: 'valid', name: 'Valid workflow' }
}

function brokenWorkflow(): ReturnType<typeof createAgentsWorkflowPageFixture> {
  const fixture = createAgentsWorkflowPageFixture()
  return {
    ...fixture,
    id: 'broken',
    name: 'Broken workflow',
    // Why: the end node becomes unreachable, which is exactly what blocks Run on the canvas.
    edges: fixture.edges.filter((edge) => edge.toNodeId !== 'end')
  }
}

function renderPanel(): void {
  render(
    <TooltipProvider>
      <AgentsWorkflowSidebarPanel />
    </TooltipProvider>
  )
}

beforeEach(() => {
  useAppStore.setState({
    activeWorktreeId: 'wt-1',
    worktreesByRepo: {
      'fixture-repo': [makeWorktree({ id: 'wt-1', repoId: 'fixture-repo' })]
    }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

describe('AgentsWorkflowSidebarPanel Run guard', () => {
  it('disables Run for a workflow the canvas would refuse to run', async () => {
    listAgentsWorkflows.mockResolvedValue([validWorkflow(), brokenWorkflow()])
    renderPanel()

    const validRun = await screen.findByRole('button', { name: 'Run Valid workflow' })
    const brokenRun = await screen.findByRole('button', { name: 'Run Broken workflow' })

    expect((validRun as HTMLButtonElement).disabled).toBe(false)
    expect((brokenRun as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('AgentsWorkflowSidebarPanel row navigation', () => {
  it('opens the workflows page on the workflow that was clicked', async () => {
    const openAgentsWorkflowPageOn = vi.fn()
    useAppStore.setState({ openAgentsWorkflowPageOn })
    listAgentsWorkflows.mockResolvedValue([validWorkflow(), brokenWorkflow()])
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'Open Broken workflow' }))

    // Why the action not the store field: the row only has to hand over the clicked id.
    expect(openAgentsWorkflowPageOn).toHaveBeenCalledWith('broken')
  })
})
