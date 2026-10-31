import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { AGENTS_WORKFLOW_METHODS } from './agents-workflow'
import type * as GenerationService from '../../../agents-workflow/workflow-generation-service'
import type * as ExecutionAdapterFactory from '../../../agents-workflow/workflow-host-execution-adapter'
import { generateAgentsWorkflowDraft } from '../../../agents-workflow/workflow-generation-service'
import { createAgentsWorkflowHostExecutionAdapter } from '../../../agents-workflow/workflow-host-execution-adapter'
import { AgentsWorkflowRevisionConflictError } from '../../../../shared/agents-workflow-errors'

// Why mock the turn: this file only checks wiring — workspace resolution and the params the
// handler hands the generator. The generation loop has its own suite.
vi.mock('../../../agents-workflow/workflow-generation-service', async (importOriginal) => {
  const actual = await importOriginal<typeof GenerationService>()
  return {
    ...actual,
    generateAgentsWorkflowDraft: vi.fn()
  }
})
vi.mock('../../../agents-workflow/workflow-host-execution-adapter', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecutionAdapterFactory>()
  return {
    ...actual,
    createAgentsWorkflowHostExecutionAdapter: vi.fn(() => ({}))
  }
})

function request(method: string, params?: unknown): RpcRequest {
  return { id: 'request-1', authToken: 'token', method, params }
}

const workflow = {
  schemaVersion: 1,
  name: 'Review',
  nodes: [{ id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } }],
  edges: [],
  runContext: {
    kind: 'workspace-run',
    projectId: 'project-1',
    hostId: 'local',
    projectHostSetupId: 'setup-1',
    repoId: 'repo-1',
    path: '/repo'
  },
  workspace: { mode: 'existing', workspaceId: 'workspace-1' },
  trigger: { manual: true, schedule: null },
  enabled: true
} as const

describe('agent workflow RPC methods', () => {
  it('routes all definition CRUD methods and revision preconditions', async () => {
    const methods = {
      getRuntimeId: () => 'runtime-1',
      listAgentsWorkflows: vi.fn(() => []),
      showAgentsWorkflow: vi.fn(() => ({ id: 'workflow-1' })),
      listAgentsWorkflowAgentChannels: vi.fn(() => []),
      createAgentsWorkflow: vi.fn(async () => ({ id: 'workflow-1' })),
      updateAgentsWorkflow: vi.fn(async () => ({ id: 'workflow-1', revision: 2 })),
      deleteAgentsWorkflow: vi.fn(async () => ({ removed: true })),
      runAgentsWorkflowNow: vi.fn(async () => ({ id: 'run-1' })),
      cancelAgentsWorkflowRun: vi.fn(async () => ({ id: 'run-1', status: 'cancelled' })),
      listAgentsWorkflowRuns: vi.fn(async () => ({ runs: [], nextCursor: null })),
      showAgentsWorkflowRun: vi.fn(async () => ({ id: 'run-1' }))
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: RpcDispatcher reads only the six mocked runtime methods exercised by this isolated registry.
    const runtime = methods as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: AGENTS_WORKFLOW_METHODS })

    await dispatcher.dispatch(request('agentsWorkflow.list', {}))
    await dispatcher.dispatch(request('agentsWorkflow.show', { id: 'workflow-1' }))
    await dispatcher.dispatch(request('agentsWorkflow.capabilities', {}))
    await dispatcher.dispatch(request('agentsWorkflow.create', { workflow }))
    await dispatcher.dispatch(
      request('agentsWorkflow.update', {
        id: 'workflow-1',
        expectedRevision: 1,
        updates: { name: 'Updated' }
      })
    )
    await dispatcher.dispatch(
      request('agentsWorkflow.delete', { id: 'workflow-1', expectedRevision: 2 })
    )
    await dispatcher.dispatch(
      request('agentsWorkflow.runNow', { workflowId: 'workflow-1', requestKey: 'request-1' })
    )
    await dispatcher.dispatch(request('agentsWorkflow.cancelRun', { runId: 'run-1' }))
    await dispatcher.dispatch(
      request('agentsWorkflow.runs', { workflowId: 'workflow-1', limit: 10 })
    )
    await dispatcher.dispatch(request('agentsWorkflow.showRun', { runId: 'run-1' }))

    expect(methods.listAgentsWorkflows).toHaveBeenCalledOnce()
    expect(methods.showAgentsWorkflow).toHaveBeenCalledWith('workflow-1')
    expect(methods.listAgentsWorkflowAgentChannels).toHaveBeenCalledOnce()
    expect(methods.createAgentsWorkflow).toHaveBeenCalledWith(workflow)
    expect(methods.updateAgentsWorkflow).toHaveBeenCalledWith('workflow-1', 1, {
      name: 'Updated'
    })
    expect(methods.deleteAgentsWorkflow).toHaveBeenCalledWith('workflow-1', 2)
    expect(methods.runAgentsWorkflowNow).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      requestKey: 'request-1'
    })
    expect(methods.cancelAgentsWorkflowRun).toHaveBeenCalledWith('run-1')
    expect(methods.listAgentsWorkflowRuns).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      limit: 10
    })
    expect(methods.showAgentsWorkflowRun).toHaveBeenCalledWith('run-1')
  })

  it('rejects missing CAS revisions before invoking a mutation', async () => {
    const updateAgentsWorkflow = vi.fn()
    const methods = { getRuntimeId: () => 'runtime-1', updateAgentsWorkflow }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Validation rejects before the dispatcher can access any other runtime member.
    const runtime = methods as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: AGENTS_WORKFLOW_METHODS })

    const response = await dispatcher.dispatch(
      request('agentsWorkflow.update', { id: 'workflow-1', updates: { name: 'Stale' } })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(updateAgentsWorkflow).not.toHaveBeenCalled()
  })

  it('returns a structured revision conflict', async () => {
    const methods = {
      getRuntimeId: () => 'runtime-1',
      updateAgentsWorkflow: vi.fn(async () => {
        throw new AgentsWorkflowRevisionConflictError(1, 2)
      })
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The request invokes only the mocked update method.
    const runtime = methods as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: AGENTS_WORKFLOW_METHODS })

    const response = await dispatcher.dispatch(
      request('agentsWorkflow.update', {
        id: 'workflow-1',
        expectedRevision: 1,
        updates: { name: 'Stale' }
      })
    )

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'agents_workflow_revision_conflict',
        data: { expectedRevision: 1, actualRevision: 2 }
      }
    })
  })

  it('generates in the workflow workspace and returns only the draft', async () => {
    const draft = { name: 'Review changes', nodes: [], edges: [] }
    vi.mocked(generateAgentsWorkflowDraft).mockResolvedValue({ draft })
    const showManagedWorktree = vi.fn(async () => ({
      id: 'workspace-1',
      path: '/repo/workspace-1'
    }))
    const methods = { getRuntimeId: () => 'runtime-1', showManagedWorktree }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The request resolves a workspace and hands it to the mocked generator.
    const runtime = methods as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: AGENTS_WORKFLOW_METHODS })

    const response = await dispatcher.dispatch(
      request('agentsWorkflow.generate', {
        request: 'Review my changes',
        workspaceId: 'workspace-1',
        agentId: 'claude',
        agentIds: ['claude', 'codex']
      })
    )

    expect(showManagedWorktree).toHaveBeenCalledWith('id:workspace-1')
    expect(createAgentsWorkflowHostExecutionAdapter).toHaveBeenCalledWith(runtime)
    expect(generateAgentsWorkflowDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        // Why the path: the file channel writes its output contract into this checkout.
        workspacePath: '/repo/workspace-1',
        agentId: 'claude',
        agentIds: ['claude', 'codex'],
        request: 'Review my changes'
      })
    )
    expect(response).toMatchObject({ ok: true, result: { draft } })
    expect(response).not.toHaveProperty('result.issues')
  })

  it('rejects an unknown generation agent before resolving a workspace', async () => {
    vi.mocked(generateAgentsWorkflowDraft).mockClear()
    const showManagedWorktree = vi.fn()
    const methods = { getRuntimeId: () => 'runtime-1', showManagedWorktree }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Validation rejects before the dispatcher can access any other runtime member.
    const runtime = methods as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: AGENTS_WORKFLOW_METHODS })

    const response = await dispatcher.dispatch(
      request('agentsWorkflow.generate', {
        request: 'Review my changes',
        workspaceId: 'workspace-1',
        agentId: 'not-an-agent',
        agentIds: ['claude']
      })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(showManagedWorktree).not.toHaveBeenCalled()
    expect(generateAgentsWorkflowDraft).not.toHaveBeenCalled()
  })
})
