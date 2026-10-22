import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileStateSqliteAuthority } from '../profile-state/profile-state-sqlite-authority'
import type { AgentsWorkflowCreateInput } from '../../../shared/agents-workflow-types'
import { AgentsWorkflowRunService } from '../../agents-workflow/workflow-run-service'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'orca-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
    whenReady: () => Promise.resolve()
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').slice('encrypted:'.length)
  },
  ipcMain: { on: () => {}, handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { Store } = await import('./store')
const temporaryDirectories: string[] = []
const authorities: ProfileStateSqliteAuthority[] = []

afterEach(() => {
  authorities.forEach((authority) => authority.close())
  authorities.length = 0
  temporaryDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  temporaryDirectories.length = 0
})

function workflowInput(creationKey = 'create-1'): AgentsWorkflowCreateInput {
  return {
    schemaVersion: 1,
    creationKey,
    name: 'Review',
    nodes: [
      { id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } },
      {
        id: 'report',
        kind: 'agent',
        title: 'Report',
        position: { x: 1, y: 0 },
        agentId: 'claude',
        prompt: { source: 'report' }
      }
    ],
    edges: [
      {
        id: 'start-report',
        fromNodeId: 'start',
        toNodeId: 'report',
        fromPort: 'default',
        toPort: 'default'
      }
    ],
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
  }
}

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), 'orca-agents-workflow-'))
  temporaryDirectories.push(directory)
  const authority = new ProfileStateSqliteAuthority(join(directory, 'profile-state.db'), 'test')
  authorities.push(authority)
  return {
    authority,
    dataFile: join(directory, 'legacy.json'),
    store: new Store({ dataFile: join(directory, 'legacy.json'), profileStateAuthority: authority })
  }
}

describe('agent workflow persistence', () => {
  it('creates idempotently, applies revision CAS, and survives reload', () => {
    const { authority, dataFile, store } = createStore()
    const created = store.createAgentsWorkflow(workflowInput())
    expect(store.createAgentsWorkflow(workflowInput())).toEqual(created)

    const updated = store.updateAgentsWorkflow(created.id, 1, { name: 'Updated' })
    expect(updated).toMatchObject({ revision: 2, name: 'Updated' })
    expect(() => store.updateAgentsWorkflow(created.id, 1, { name: 'Stale' })).toThrow(
      /revision conflict/
    )

    const reloaded = new Store({ dataFile, profileStateAuthority: authority })
    expect(reloaded.showAgentsWorkflow(created.id)).toMatchObject({
      revision: 2,
      name: 'Updated'
    })
  })

  it('requires the current revision when deleting', () => {
    const { store } = createStore()
    const created = store.createAgentsWorkflow(workflowInput('create-2'))
    expect(() => store.deleteAgentsWorkflow(created.id, 2)).toThrow(/revision conflict/)
    expect(store.deleteAgentsWorkflow(created.id, 1)).toBe(true)
    expect(store.listAgentsWorkflows()).toEqual([])
  })

  it('deletes the workflow run history with the workflow', () => {
    const { store } = createStore()
    const workflow = store.createAgentsWorkflow(workflowInput('delete-runs'))
    const kept = store.createAgentsWorkflow(workflowInput('keep-runs'))
    const doomed = store.createAgentsWorkflowRun({ workflow, requestKey: 'r1', now: 1 })
    store.updateAgentsWorkflowRun(doomed.run.id, { status: 'completed', finishedAt: 2 })
    const survivor = store.createAgentsWorkflowRun({ workflow: kept, requestKey: 'r2', now: 3 })
    store.updateAgentsWorkflowRun(survivor.run.id, { status: 'completed', finishedAt: 4 })

    store.deleteAgentsWorkflow(workflow.id, workflow.revision)

    // Why: retention only prunes the workflow being written, so these rows would never be reclaimed.
    expect(() => store.showAgentsWorkflowRun(doomed.run.id)).toThrow(/not found/)
    expect(store.showAgentsWorkflowRun(survivor.run.id).workflowId).toBe(kept.id)
  })

  it('lets an active run settle after its workflow is deleted, then drops it', () => {
    const { store } = createStore()
    const workflow = store.createAgentsWorkflow(workflowInput('delete-active'))
    const active = store.createAgentsWorkflowRun({ workflow, requestKey: 'live', now: 1 })

    store.deleteAgentsWorkflow(workflow.id, workflow.revision)

    // Why keep it: the run is still writing; deleting its row would make every checkpoint throw.
    expect(store.showAgentsWorkflowRun(active.run.id).status).toBe('pending')
    store.updateAgentsWorkflowRun(active.run.id, { status: 'failed', finishedAt: 2 })
    expect(() => store.showAgentsWorkflowRun(active.run.id)).toThrow(/not found/)
  })

  it('locks the checkout a new_per_run workflow creates, not a null workspace', () => {
    const { store } = createStore()
    const base = workflowInput('checkout-a')
    const first = store.createAgentsWorkflow({
      ...base,
      workspace: { mode: 'new_per_run', baseBranch: 'main', setupDecision: 'skip' }
    })
    store.createAgentsWorkflowRun({ workflow: first, requestKey: 'first', now: 1 })

    const sameCheckout = store.createAgentsWorkflow({
      ...workflowInput('checkout-b'),
      workspace: { mode: 'new_per_run', baseBranch: 'main', setupDecision: 'skip' }
    })
    expect(() =>
      store.createAgentsWorkflowRun({ workflow: sameCheckout, requestKey: 'second', now: 2 })
    ).toThrow(/active workflow run/)

    const otherBranch = store.createAgentsWorkflow({
      ...workflowInput('checkout-c'),
      workspace: { mode: 'new_per_run', baseBranch: 'release', setupDecision: 'skip' }
    })
    expect(
      store.createAgentsWorkflowRun({ workflow: otherBranch, requestKey: 'third', now: 3 }).created
    ).toBe(true)
  })

  it('stores a half-wired graph as a draft', () => {
    const { store } = createStore()
    const input = workflowInput('draft-graph')
    input.nodes = [{ id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } }]
    input.edges = []

    // Why allow the write: the canvas blocks Run until the graph compiles, but a draft the author
    // is still wiring must survive closing the window.
    const drafted = store.createAgentsWorkflow(input)
    expect(drafted.id).toBeTruthy()
    expect(store.showAgentsWorkflow(drafted.id).nodes).toHaveLength(1)
  })

  it('still refuses a definition the schema cannot represent', () => {
    const { store } = createStore()
    const input = workflowInput('schema-invalid')
    input.nodes = [
      { id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } },
      { id: 'loop', kind: 'loop', title: 'Loop', position: { x: 0, y: 1 }, count: 0 }
    ]
    input.edges = []

    expect(() => store.createAgentsWorkflow(input)).toThrow(/schema|count/i)
  })

  it('refuses an unparseable schedule instead of letting the ticker throw every minute', () => {
    const { store } = createStore()
    const input = workflowInput('invalid-schedule')
    input.trigger = {
      manual: true,
      schedule: {
        timezone: 'Mars/Olympus',
        rrule: 'NOT-AN-RRULE',
        dtstart: 1,
        missedRunGraceMinutes: 5
      }
    }

    expect(() => store.createAgentsWorkflow(input)).toThrow(/timezone|recurrence|parse/i)
  })

  it('does not let a late checkpoint rewrite a finished run', () => {
    const { store } = createStore()
    const workflow = store.createAgentsWorkflow(workflowInput('terminal-run'))
    const created = store.createAgentsWorkflowRun({
      workflow,
      requestKey: 'terminal-run',
      now: 1
    })
    store.updateAgentsWorkflowRun(created.run.id, { status: 'cancelled', finishedAt: 2 })
    store.replaceAgentsWorkflowRunTrace(created.run.id, [], ['stale'])
    store.updateAgentsWorkflowRun(created.run.id, { status: 'running' })

    expect(store.showAgentsWorkflowRun(created.run.id)).toMatchObject({
      status: 'cancelled',
      finishedAt: 2,
      executionTrace: []
    })
  })

  it('persists runs, deduplicates request keys, locks active workspaces, and recovers safely', () => {
    const { authority, dataFile, store } = createStore()
    const workflow = store.createAgentsWorkflow(workflowInput('run-workflow'))
    const first = store.createAgentsWorkflowRun({
      workflow,
      requestKey: 'request-1',
      now: 10
    })
    expect(first.created).toBe(true)
    expect(
      store.createAgentsWorkflowRun({
        workflow,
        requestKey: 'request-1',
        now: 11
      })
    ).toEqual({ run: first.run, created: false })
    expect(() =>
      store.createAgentsWorkflowRun({
        workflow,
        requestKey: 'request-2',
        now: 12
      })
    ).toThrow(/active workflow run/)

    const reloaded = new Store({ dataFile, profileStateAuthority: authority })
    expect(reloaded.showAgentsWorkflowRun(first.run.id)).toMatchObject({
      requestKey: 'request-1',
      status: 'unverifiable',
      errorCode: 'execution_evidence_lost'
    })
    // Why still returned: the load already settled the run, but its scratch folder is still on disk.
    expect(reloaded.markInterruptedAgentsWorkflowRunsUnverifiable(20)).toEqual([
      expect.objectContaining({ id: first.run.id, scratchCleanupPending: true })
    ])
    expect(reloaded.showAgentsWorkflowRun(first.run.id)).toMatchObject({
      status: 'unverifiable',
      errorCode: 'execution_evidence_lost',
      scratchCleanupPending: true
    })

    reloaded.updateAgentsWorkflowRun(first.run.id, { scratchCleanupPending: false })
    expect(reloaded.markInterruptedAgentsWorkflowRunsUnverifiable(30)).toEqual([])
  })

  it('runs through an injected structured adapter and persists the completed trace', async () => {
    const { store } = createStore()
    // Why a real directory: an agent with a downstream node has to write its answer file.
    const workspacePath = mkdtempSync(join(tmpdir(), 'orca-agents-workflow-run-'))
    temporaryDirectories.push(workspacePath)
    const input = workflowInput('executable')
    input.nodes.push({
      id: 'agent',
      kind: 'agent',
      title: 'Agent',
      position: { x: 1, y: 0 },
      agentId: 'claude',
      prompt: { source: 'Report the workspace status.' }
    })
    input.edges.push(
      {
        id: 'start-agent',
        fromNodeId: 'start',
        toNodeId: 'agent',
        fromPort: 'default',
        toPort: 'default'
      },
      {
        id: 'agent-report',
        fromNodeId: 'agent',
        toNodeId: 'report',
        fromPort: 'default',
        toPort: 'default'
      }
    )
    const workflow = store.createAgentsWorkflow(input)
    const service = new AgentsWorkflowRunService(
      store,
      vi.fn(),
      {
        execute: async ({ prompt }) => ({
          ok: true,
          output: {
            format: 'plain_text',
            content: prompt,
            capturedAt: 30,
            truncated: false,
            source: 'structured_assistant_message'
          }
        }),
        cancel: async () => 'stopped'
      },
      async () => ({
        ok: true,
        workspaceId: 'workspace-1',
        workspacePath,
        displayName: 'Workspace'
      }),
      () => 30
    )

    const started = await service.runNow({
      workflowId: workflow.id,
      requestKey: 'execute-1'
    })
    await vi.waitFor(() => {
      expect(store.showAgentsWorkflowRun(started.id)).toMatchObject({
        status: 'completed',
        executionTrace: ['start', 'agent', 'report']
      })
      expect(
        store
          .showAgentsWorkflowRun(started.id)
          .attempts.find((attempt) => attempt.nodeId === 'agent')
      ).toMatchObject({ status: 'completed' })
    })
  })

  it('retains 100 terminal runs without pruning active or unverifiable runs', () => {
    const { store } = createStore()
    const workflow = store.createAgentsWorkflow(workflowInput('retention'))
    let oldestRunId = ''
    for (let index = 0; index < 102; index += 1) {
      const created = store.createAgentsWorkflowRun({
        workflow,
        requestKey: `terminal-${index}`,
        now: index
      })
      if (index === 0) {
        oldestRunId = created.run.id
      }
      store.updateAgentsWorkflowRun(created.run.id, {
        status: 'completed',
        finishedAt: index
      })
    }
    const unverifiable = store.createAgentsWorkflowRun({
      workflow,
      requestKey: 'unverifiable',
      now: 200
    })
    store.updateAgentsWorkflowRun(unverifiable.run.id, {
      status: 'unverifiable',
      finishedAt: 200
    })
    const active = store.createAgentsWorkflowRun({
      workflow,
      requestKey: 'active',
      now: 201
    })

    const retained = store.listAgentsWorkflowRuns({ workflowId: workflow.id, limit: 100 })
    expect(retained.runs).toHaveLength(100)
    expect(store.showAgentsWorkflowRun(unverifiable.run.id).status).toBe('unverifiable')
    expect(store.showAgentsWorkflowRun(active.run.id).status).toBe('pending')
    expect(() => store.showAgentsWorkflowRun(oldestRunId)).toThrow(/not found/)
  })
})
