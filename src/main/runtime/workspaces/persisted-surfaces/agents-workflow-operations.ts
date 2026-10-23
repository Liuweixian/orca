// The host surface for agent workflows: definitions, runs, and the service that executes them.

import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowRunContext,
  AgentsWorkflowUpdateFields,
  AgentsWorkflowWorkspace
} from '../../../../shared/agents-workflow-types'
import {
  AgentsWorkflowDefinitionInvalidError,
  type AgentsWorkflowDefinitionIssue
} from '../../../../shared/agents-workflow-errors'
import {
  agentsWorkflowAgentChannelPlanEntries,
  type AgentsWorkflowAgentChannelEntry
} from '../../../../shared/agents-workflow-agent-channels'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage
} from '../../../../shared/agents-workflow-run-types'
import { OrcaRuntimeWithRestoredTerminalPlacement } from './restored-terminal-placement'
import { AgentsWorkflowRunService } from '../../../agents-workflow/workflow-run-service'
import { createAgentsWorkflowExecutionAdapter } from '../../../agents-workflow/workflow-agent-execution-adapter'
import { createWorkflowStructuredTurnRunner } from '../../../agents-workflow/workflow-structured-turn-runner'
import { createWorkflowFileHandoffTurnRunner } from '../../../agents-workflow/workflow-file-handoff-runner'
import { createWorkflowTranscriptTurnRunner } from '../../../agents-workflow/workflow-transcript-turn-runner'
import { createWorkflowReportTurnRunner } from '../../../agents-workflow/workflow-report-turn-runner'
import { createAgentsWorkflowWorkspaceResolver } from '../../../agents-workflow/workflow-workspace-resolver'
import type { OrcaRuntimeService } from '../../orca-runtime'

export abstract class OrcaRuntimeWithAgentsWorkflowOperations extends OrcaRuntimeWithRestoredTerminalPlacement {
  private agentsWorkflowRunService: AgentsWorkflowRunService | null = null

  abstract notifyAgentsWorkflowsChanged(payload?: { reason?: 'definition' | 'run' }): void

  /** A later mixin owns worktree removal; this layer only needs the seam. */
  protected abstract removeManagedWorktree(
    selector: string,
    options?: { runHooks?: boolean; force?: boolean }
  ): Promise<unknown>

  listAgentsWorkflows(): AgentsWorkflowDefinition[] {
    if (!this.store?.listAgentsWorkflows) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAgentsWorkflows()
  }

  /** Every agent a workflow may reference, with the channels this host can run it through. */
  listAgentsWorkflowAgentChannels(): AgentsWorkflowAgentChannelEntry[] {
    return [...agentsWorkflowAgentChannelPlanEntries()]
  }

  showAgentsWorkflow(id: string): AgentsWorkflowDefinition {
    if (!this.store?.showAgentsWorkflow) {
      throw new Error('runtime_unavailable')
    }
    return this.store.showAgentsWorkflow(id)
  }

  async createAgentsWorkflow(input: AgentsWorkflowCreateInput): Promise<AgentsWorkflowDefinition> {
    if (!this.store?.createAgentsWorkflow) {
      throw new Error('runtime_unavailable')
    }
    await this.assertAgentsWorkflowTargetResolvable(input)
    const workflow = this.store.createAgentsWorkflow(input)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    this.notifyAgentsWorkflowsChanged({ reason: 'definition' })
    return workflow
  }

  async updateAgentsWorkflow(
    id: string,
    expectedRevision: number,
    updates: AgentsWorkflowUpdateFields
  ): Promise<AgentsWorkflowDefinition> {
    if (!this.store?.updateAgentsWorkflow) {
      throw new Error('runtime_unavailable')
    }
    if (updates.runContext !== undefined || updates.workspace !== undefined) {
      const current = this.showAgentsWorkflow(id)
      await this.assertAgentsWorkflowTargetResolvable({
        runContext: updates.runContext ?? current.runContext,
        workspace: updates.workspace ?? current.workspace
      })
    }
    const workflow = this.store.updateAgentsWorkflow(id, expectedRevision, updates)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    this.notifyAgentsWorkflowsChanged({ reason: 'definition' })
    return workflow
  }

  async deleteAgentsWorkflow(id: string, expectedRevision: number): Promise<{ removed: true }> {
    if (!this.store?.deleteAgentsWorkflow) {
      throw new Error('runtime_unavailable')
    }
    this.store.deleteAgentsWorkflow(id, expectedRevision)
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    this.notifyAgentsWorkflowsChanged({ reason: 'definition' })
    return { removed: true }
  }

  runAgentsWorkflowNow(input: {
    workflowId: string
    requestKey: string
  }): Promise<AgentsWorkflowRun> {
    return this.getAgentsWorkflowRunService().runNow(input)
  }

  runScheduledAgentsWorkflow(
    workflow: AgentsWorkflowDefinition,
    scheduledFor: number
  ): Promise<AgentsWorkflowRun> {
    return this.getAgentsWorkflowRunService().runScheduled(workflow, scheduledFor)
  }

  recordSkippedAgentsWorkflowOccurrence(
    workflow: AgentsWorkflowDefinition,
    scheduledFor: number,
    reason: 'missed_grace'
  ): Promise<AgentsWorkflowRun> {
    return this.getAgentsWorkflowRunService().recordSkippedOccurrence(
      workflow,
      scheduledFor,
      reason
    )
  }

  cancelAgentsWorkflowRun(runId: string): Promise<AgentsWorkflowRun> {
    return this.getAgentsWorkflowRunService().cancelRun(runId)
  }

  /** How many finished runs of this workflow were dropped; active runs are kept. */
  async clearAgentsWorkflowRuns(workflowId: string): Promise<number> {
    if (!this.store?.clearAgentsWorkflowRuns) {
      throw new Error('runtime_unavailable')
    }
    const removed = this.store.clearAgentsWorkflowRuns(workflowId)
    if (removed === 0) {
      return 0
    }
    await this.store.flushPendingOrThrowAsync?.({ drainToStableGeneration: false })
    this.notifyAgentsWorkflowsChanged({ reason: 'run' })
    return removed
  }

  listAgentsWorkflowRuns(input: {
    workflowId?: string
    cursor?: string
    limit: number
  }): Promise<AgentsWorkflowRunsPage> {
    return this.getAgentsWorkflowRunService().runs(input)
  }

  showAgentsWorkflowRun(runId: string): Promise<AgentsWorkflowRun> {
    return this.getAgentsWorkflowRunService().showRun(runId)
  }

  /**
   * Why refuse the write: a graph with a target this host cannot resolve saves fine and then
   * fails every run — and for a schedule, nobody is watching when it fails.
   */
  private async assertAgentsWorkflowTargetResolvable(target: {
    runContext: AgentsWorkflowRunContext
    workspace: AgentsWorkflowWorkspace
  }): Promise<void> {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Runtime mixins are assembled into OrcaRuntimeService; this layer cannot statically see later mixins.
    const runtime = this as OrcaRuntimeService
    const issues: AgentsWorkflowDefinitionIssue[] = []
    let repoResolved = false
    try {
      await runtime.showRepo(`id:${target.runContext.repoId}`)
      repoResolved = true
    } catch {
      issues.push({
        severity: 'error',
        code: 'run_context_repo_unresolved',
        message: "The workflow's project cannot be found on this host."
      })
    }
    if (target.workspace.mode === 'existing') {
      try {
        const workspace = await this.showManagedWorktree(`id:${target.workspace.workspaceId}`)
        if (repoResolved && workspace.repoId !== target.runContext.repoId) {
          issues.push({
            severity: 'error',
            code: 'run_context_workspace_mismatch',
            message: 'The chosen workspace belongs to a different project.'
          })
        }
      } catch {
        issues.push({
          severity: 'error',
          code: 'run_context_workspace_unresolved',
          message: 'The chosen workspace cannot be found on this host.'
        })
      }
    }
    if (issues.length > 0) {
      throw new AgentsWorkflowDefinitionInvalidError(issues)
    }
  }

  private getAgentsWorkflowRunService(): AgentsWorkflowRunService {
    if (this.agentsWorkflowRunService) {
      return this.agentsWorkflowRunService
    }
    const store = this.store
    if (
      !store?.showAgentsWorkflow ||
      !store.createAgentsWorkflowRun ||
      !store.createSkippedAgentsWorkflowOccurrence ||
      !store.updateAgentsWorkflowRun ||
      !store.replaceAgentsWorkflowRunTrace ||
      !store.showAgentsWorkflowRun ||
      !store.listAgentsWorkflowRuns ||
      !store.markInterruptedAgentsWorkflowRunsUnverifiable
    ) {
      throw new Error('runtime_unavailable')
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Runtime mixins are assembled into OrcaRuntimeService; this layer cannot statically see later mixins.
    const runtime = this as OrcaRuntimeService
    this.agentsWorkflowRunService = new AgentsWorkflowRunService(
      {
        showAgentsWorkflow: store.showAgentsWorkflow.bind(store),
        createAgentsWorkflowRun: store.createAgentsWorkflowRun.bind(store),
        createSkippedAgentsWorkflowOccurrence:
          store.createSkippedAgentsWorkflowOccurrence.bind(store),
        updateAgentsWorkflowRun: store.updateAgentsWorkflowRun.bind(store),
        replaceAgentsWorkflowRunTrace: store.replaceAgentsWorkflowRunTrace.bind(store),
        showAgentsWorkflowRun: store.showAgentsWorkflowRun.bind(store),
        listAgentsWorkflowRuns: store.listAgentsWorkflowRuns.bind(store),
        markInterruptedAgentsWorkflowRunsUnverifiable:
          store.markInterruptedAgentsWorkflowRunsUnverifiable.bind(store),
        flushPendingOrThrowAsync: store.flushPendingOrThrowAsync?.bind(store)
      },
      () => this.notifyAgentsWorkflowsChanged({ reason: 'run' }),
      createAgentsWorkflowExecutionAdapter(
        createWorkflowStructuredTurnRunner(runtime),
        createWorkflowFileHandoffTurnRunner(runtime),
        createWorkflowTranscriptTurnRunner(runtime),
        createWorkflowReportTurnRunner(runtime)
      ),
      createAgentsWorkflowWorkspaceResolver(runtime),
      Date.now,
      async (workspaceId) => {
        const workspace = await this.showManagedWorktree(`id:${workspaceId}`)
        return workspace.path
      },
      async (workspaceId) => {
        // Why force: a scheduled run's checkout is scratch that the agent has already modified;
        // a normal removal refuses a dirty worktree and the folder would never be reclaimed. The
        // node values are in run history, so nothing the user needs lives only there.
        await this.removeManagedWorktree(`id:${workspaceId}`, {
          force: true,
          runHooks: false
        })
      }
    )
    return this.agentsWorkflowRunService
  }
}
