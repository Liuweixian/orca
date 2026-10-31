// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import { AgentsWorkflowGenerateDialog } from './agents-workflow-generate-dialog'
import { createAgentsWorkflowPageFixture } from './agents-workflow-page-fixtures'

function existingWorkspaceDefinition(): AgentsWorkflowDefinition {
  return {
    ...createAgentsWorkflowPageFixture(),
    workspace: { mode: 'existing', workspaceId: 'workspace-1' }
  }
}

const initialState = useAppStore.getInitialState()

beforeEach(() => {
  useAppStore.setState({
    ensureNativeDetectedAgents: async () => [],
    localDetectedAgentIdsByContext: { host: ['claude'] }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
})

describe('AgentsWorkflowGenerateDialog', () => {
  // Why close on submit: the design turn outlives the dialog, so a modal left open for minutes only
  // invites the user to close it, which used to abandon the turn.
  it('hands the request over and closes instead of waiting for the answer', () => {
    const onGenerate = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <AgentsWorkflowGenerateDialog
        open
        onOpenChange={onOpenChange}
        definition={existingWorkspaceDefinition()}
        generating={false}
        onGenerate={onGenerate}
      />
    )

    fireEvent.change(screen.getByLabelText('What should this workflow do?'), {
      target: { value: 'Review my changes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(onGenerate).toHaveBeenCalledWith({
      request: 'Review my changes',
      workspaceId: 'workspace-1',
      agentId: 'claude',
      agentIds: ['claude']
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the request on the dialog when the workflow has no workspace to run in', () => {
    const onGenerate = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <AgentsWorkflowGenerateDialog
        open
        onOpenChange={onOpenChange}
        definition={createAgentsWorkflowPageFixture()}
        generating={false}
        onGenerate={onGenerate}
      />
    )

    fireEvent.change(screen.getByLabelText('What should this workflow do?'), {
      target: { value: 'Review my changes' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    expect(onGenerate).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
