import { describe, expect, it, vi } from 'vitest'
import type { AgentsWorkflowDefinition } from '../../shared/agents-workflow-types'
import type { AgentsWorkflowRun } from '../../shared/agents-workflow-run-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { AgentsWorkflowRunService, type AgentsWorkflowRunPersistence } from './workflow-run-service'

function definition(): AgentsWorkflowDefinition {
  return {
    schemaVersion: 1,
    id: 'workflow-1',
    revision: 1,
    name: 'Workflow',
    enabled: true,
    runContext: {
      kind: 'workspace-run',
      projectId: 'project-1',
      hostId: LOCAL_EXECUTION_HOST_ID,
      projectHostSetupId: 'setup-1',
      repoId: 'repo-1',
      path: '/repo/workspace-1'
    },
    workspace: { mode: 'existing', workspaceId: 'workspace-1' },
    trigger: { manual: true, schedule: null },
    schedulerOwner: 'local_host_service',
    nodes: [
      {
        id: 'start',
        kind: 'start',
        title: 'Start',
        position: { x: 0, y: 0 }
      },
      {
        id: 'agent-1',
        kind: 'agent',
        title: 'Agent',
        position: { x: 1, y: 0 },
        agentId: 'claude',
        prompt: { source: 'work' },
        terminal: true
      }
    ],
    edges: [
      {
        id: 'start-agent',
        fromNodeId: 'start',
        toNodeId: 'agent-1',
        fromPort: 'default',
        toPort: 'default'
      }
    ],
    createdAt: 1,
    updatedAt: 1
  }
}

function persistence(): AgentsWorkflowRunPersistence & { run: () => AgentsWorkflowRun } {
  let run: AgentsWorkflowRun | null = null
  const show = (): AgentsWorkflowRun => {
    if (!run) {
      throw new Error('run was not created')
    }
    return run
  }
  return {
    showAgentsWorkflow: () => definition(),
    createAgentsWorkflowRun: (input) => {
      run = {
        schemaVersion: 1,
        id: 'run-1',
        workflowId: input.workflow.id,
        workflowRevision: input.workflow.revision,
        definitionSnapshot: input.workflow,
        requestKey: input.requestKey,
        trigger: input.trigger ?? 'manual',
        status: 'pending',
        workspaceId: null,
        workspaceDisplayName: null,
        attempts: [],
        executionTrace: [],
        createdAt: input.now,
        startedAt: null,
        finishedAt: null
      }
      return { run, created: true }
    },
    createSkippedAgentsWorkflowOccurrence: () => {
      throw new Error('not used')
    },
    updateAgentsWorkflowRun: (_runId, updates) => {
      run = { ...show(), ...updates }
      return run
    },
    replaceAgentsWorkflowRunTrace: (_runId, attempts, executionTrace) => {
      run = { ...show(), attempts: [...attempts], executionTrace: [...executionTrace] }
      return run
    },
    showAgentsWorkflowRun: show,
    listAgentsWorkflowRuns: () => ({ runs: [], nextCursor: null }),
    markInterruptedAgentsWorkflowRunsUnverifiable: () => [],
    run: () => show()
  }
}

const workspace = async () => ({
  ok: true as const,
  workspaceId: 'workspace-1',
  workspacePath: '/repo/workspace-1',
  displayName: 'Workspace'
})

describe('AgentsWorkflowRunService execution guards', () => {
  it('fails a run whose executor throws instead of leaving it running', async () => {
    const store = persistence()
    const service = new AgentsWorkflowRunService(
      store,
      vi.fn(),
      {
        execute: async () => {
          throw new Error('pane exploded')
        },
        cancel: async () => 'stopped'
      },
      workspace,
      () => 10
    )

    const started = await service.runNow({ workflowId: 'workflow-1', requestKey: 'r1' })
    await vi.waitFor(() => {
      expect(store.showAgentsWorkflowRun(started.id)).toMatchObject({
        status: 'failed',
        // The node's own attempt now carries the throw, so the run names it instead of the
        // generic run-level code.
        errorCode: 'agent_turn_failed',
        errorMessage: 'pane exploded'
      })
    })
    expect(store.showAgentsWorkflowRun(started.id).attempts.at(-1)).toMatchObject({
      status: 'failed',
      errorCode: 'agent_turn_failed'
    })
  })

  it('records a cancelled run as cancelled even when the channel also doubts the stop', async () => {
    const store = persistence()
    const service = new AgentsWorkflowRunService(
      store,
      vi.fn(),
      {
        execute: async () => ({
          ok: false,
          code: 'cancelled',
          message: 'Workflow run was cancelled.',
          cancelled: true,
          unverifiable: true
        }),
        cancel: async () => 'stopped'
      },
      workspace,
      () => 10
    )

    const started = await service.runNow({ workflowId: 'workflow-1', requestKey: 'r1' })
    await vi.waitFor(() => {
      // Why cancelled first: the user asked for this; unverifiable would blame the host.
      expect(store.showAgentsWorkflowRun(started.id)).toMatchObject({
        status: 'cancelled',
        errorCode: 'cancelled'
      })
    })
  })

  it('removes the checkout a scheduled new_per_run run created', async () => {
    const store = persistence()
    const reclaim = vi.fn(async () => undefined)
    const scheduled = {
      ...definition(),
      workspace: { mode: 'new_per_run' as const, baseBranch: null, setupDecision: 'skip' as const }
    }
    const service = new AgentsWorkflowRunService(
      store,
      vi.fn(),
      {
        execute: async () => ({
          ok: true,
          output: {
            format: 'plain_text',
            content: 'done',
            capturedAt: 10,
            truncated: false,
            source: 'structured_assistant_message'
          }
        }),
        cancel: async () => 'stopped'
      },
      workspace,
      () => 10,
      async () => '/repo/workspace-1',
      reclaim
    )

    const started = await service.runScheduled(scheduled, 1_000)
    await vi.waitFor(() => {
      expect(store.showAgentsWorkflowRun(started.id)).toMatchObject({ status: 'completed' })
    })
    // Why: one checkout per occurrence would grow the repo's workspace list forever.
    expect(reclaim).toHaveBeenCalledWith('workspace-1')
  })

  it('keeps the checkout a manual new_per_run run created', async () => {
    const store = persistence()
    const reclaim = vi.fn(async () => undefined)
    const manual = {
      ...definition(),
      workspace: { mode: 'new_per_run' as const, baseBranch: null, setupDecision: 'skip' as const }
    }
    const service = new AgentsWorkflowRunService(
      {
        ...store,
        showAgentsWorkflow: () => manual
      },
      vi.fn(),
      {
        execute: async () => ({
          ok: true,
          output: {
            format: 'plain_text',
            content: 'done',
            capturedAt: 10,
            truncated: false,
            source: 'structured_assistant_message'
          }
        }),
        cancel: async () => 'stopped'
      },
      workspace,
      () => 10,
      async () => '/repo/workspace-1',
      reclaim
    )

    const started = await service.runNow({ workflowId: 'workflow-1', requestKey: 'r1' })
    await vi.waitFor(() => {
      expect(store.showAgentsWorkflowRun(started.id)).toMatchObject({ status: 'completed' })
    })
    expect(reclaim).not.toHaveBeenCalled()
  })

  it('keeps the schedule result when reclaiming panes throws', async () => {
    const store = persistence()
    const service = new AgentsWorkflowRunService(
      store,
      vi.fn(),
      {
        execute: async () => ({
          ok: true,
          output: {
            format: 'plain_text',
            content: 'done',
            capturedAt: 10,
            truncated: false,
            source: 'structured_assistant_message'
          }
        }),
        cancel: async () => 'stopped',
        release: async () => {
          throw new Error('pane already gone')
        }
      },
      workspace,
      () => 10
    )

    const started = await service.runNow({ workflowId: 'workflow-1', requestKey: 'r1' })
    await vi.waitFor(() => {
      expect(store.showAgentsWorkflowRun(started.id)).toMatchObject({ status: 'completed' })
    })
  })
})
