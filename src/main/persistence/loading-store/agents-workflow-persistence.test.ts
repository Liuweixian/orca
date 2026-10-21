import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileStateSqliteAuthority } from '../profile-state/profile-state-sqlite-authority'
import type { AgentsWorkflowCreateInput } from '../../../shared/agents-workflow-types'
import { AgentsWorkflowRunService } from '../../agents-workflow/workflow-run-service'
import Database from '../../sqlite/sync-database'

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
        prompt: { source: 'report', bindings: {} },
        terminal: true
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
    trigger: { manual: true, defaultInput: '', schedule: null },
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

  it('refuses a definition whose graph cannot run', () => {
    const { store } = createStore()
    const input = workflowInput('invalid-graph')
    input.nodes = [{ id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } }]
    input.edges = []

    // Why refuse the write: a stored definition that cannot compile fails on every scheduled
    // occurrence, where nobody sees the error.
    expect(() => store.createAgentsWorkflow(input)).toThrow(/terminal agent/)
  })

  it('refuses an unparseable schedule instead of letting the ticker throw every minute', () => {
    const { store } = createStore()
    const input = workflowInput('invalid-schedule')
    input.trigger = {
      manual: true,
      defaultInput: '',
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
      runInput: '',
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
      runInput: 'review',
      requestKey: 'request-1',
      now: 10
    })
    expect(first.created).toBe(true)
    expect(
      store.createAgentsWorkflowRun({
        workflow,
        runInput: 'ignored retry',
        requestKey: 'request-1',
        now: 11
      })
    ).toEqual({ run: first.run, created: false })
    expect(() =>
      store.createAgentsWorkflowRun({
        workflow,
        runInput: 'conflict',
        requestKey: 'request-2',
        now: 12
      })
    ).toThrow(/active workflow run/)
    const projection = new Database(join(dirname(dataFile), 'profile-state.db'), {
      readonly: true
    })
    expect(
      projection
        .prepare(
          'SELECT workflow_id, request_key, status FROM profile_state_agents_workflow_runs WHERE run_id = ?'
        )
        .get(first.run.id)
    ).toEqual({
      workflow_id: workflow.id,
      request_key: 'request-1',
      status: 'pending'
    })
    projection.close()

    const reloaded = new Store({ dataFile, profileStateAuthority: authority })
    expect(reloaded.showAgentsWorkflowRun(first.run.id)).toMatchObject({
      requestKey: 'request-1',
      status: 'unverifiable',
      errorCode: 'execution_evidence_lost'
    })
    reloaded.markInterruptedAgentsWorkflowRunsUnverifiable(20)
    expect(reloaded.showAgentsWorkflowRun(first.run.id)).toMatchObject({
      status: 'unverifiable',
      errorCode: 'execution_evidence_lost'
    })
  })

  it('runs through an injected structured adapter and persists the completed trace', async () => {
    const { store } = createStore()
    const input = workflowInput('executable')
    input.nodes.push({
      id: 'agent',
      kind: 'agent',
      title: 'Agent',
      position: { x: 1, y: 0 },
      agentId: 'claude',
      prompt: { source: '{{binding:input}}', bindings: { input: { kind: 'run_input' } } },
      terminal: true
    })
    input.edges.push({
      id: 'start-agent',
      fromNodeId: 'start',
      toNodeId: 'agent',
      fromPort: 'default',
      toPort: 'default'
    })
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
        workspacePath: '/repo/workspace-1',
        displayName: 'Workspace'
      }),
      () => 30
    )

    const started = await service.runNow({
      workflowId: workflow.id,
      input: 'trusted output',
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
        runInput: '',
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
      runInput: '',
      requestKey: 'unverifiable',
      now: 200
    })
    store.updateAgentsWorkflowRun(unverifiable.run.id, {
      status: 'unverifiable',
      finishedAt: 200
    })
    const active = store.createAgentsWorkflowRun({
      workflow,
      runInput: '',
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
