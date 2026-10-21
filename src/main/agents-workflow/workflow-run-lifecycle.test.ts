import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentsWorkflowRun } from '../../shared/agents-workflow-run-types'
import { agentsWorkflowRunDirectory } from '../../shared/agents-workflow-output-paths'
import { recoverInterruptedAgentsWorkflowRuns } from './workflow-run-lifecycle'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function interruptedRun(runContextPath: string): AgentsWorkflowRun {
  return {
    schemaVersion: 1,
    id: 'run-1',
    workflowId: 'workflow-1',
    workflowRevision: 1,
    definitionSnapshot: {
      schemaVersion: 1,
      id: 'workflow-1',
      revision: 1,
      name: 'Workflow',
      nodes: [{ id: 'start', kind: 'start', title: 'Start', position: { x: 0, y: 0 } }],
      edges: [],
      runContext: {
        kind: 'workspace-run',
        projectId: 'project-1',
        hostId: 'local',
        projectHostSetupId: 'setup-1',
        repoId: 'repo-1',
        path: runContextPath
      },
      workspace: { mode: 'new_per_run', baseBranch: null, setupDecision: 'skip' },
      trigger: { manual: true, defaultInput: '', schedule: null },
      schedulerOwner: 'local_host_service',
      enabled: true,
      createdAt: 1,
      updatedAt: 1
    },
    requestKey: 'r1',
    trigger: 'manual',
    input: '',
    status: 'running',
    workspaceId: 'workspace-1',
    workspaceDisplayName: 'Workflow run-1',
    attempts: [],
    executionTrace: [],
    createdAt: 1,
    startedAt: 1,
    finishedAt: null
  }
}

describe('recoverInterruptedAgentsWorkflowRuns', () => {
  it('cleans the workspace the run actually used, not its project path', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'orca-workflow-recovery-'))
    directories.push(workspacePath)
    const runDir = agentsWorkflowRunDirectory(workspacePath, 'run-1')
    await mkdir(join(runDir, 'answers'), { recursive: true })
    await writeFile(join(runDir, 'answers', 'node.md'), 'answer')

    const run = interruptedRun('/repo/project')
    const updateAgentsWorkflowRun = vi.fn()
    await recoverInterruptedAgentsWorkflowRuns({
      persistence: {
        markInterruptedAgentsWorkflowRunsUnverifiable: () => [run],
        updateAgentsWorkflowRun,
        flushPendingOrThrowAsync: async () => undefined
      },
      notifyChanged: vi.fn(),
      now: () => 10,
      resolveWorkspacePath: async (workspaceId) =>
        workspaceId === 'workspace-1' ? workspacePath : null
    })

    // A new_per_run run wrote into the worktree it created, not into the project folder.
    expect(existsSync(runDir)).toBe(false)
    expect(updateAgentsWorkflowRun).not.toHaveBeenCalled()
  })
})
