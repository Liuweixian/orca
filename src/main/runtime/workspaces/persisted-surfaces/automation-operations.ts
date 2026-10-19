import type { AutomationsChangedPayload } from '../../../../shared/runtime-client-events'
import type { ResolvedWorktree } from '../../runtime-worktree-path-identity'
import { OrcaRuntimeWithPtyForegroundProcessReads } from '../../client/runtime-client-state'
import type {
  AutomationOwnerPrecondition,
  AutomationDestination
} from '../../../../shared/automation-owner-precondition'
import type { Automation, AutomationRun } from '../../../../shared/automations-types'
import type {
  RuntimeAutomationCreateInput,
  RuntimeAutomationUpdateInput
} from '../../runtime-automation-controller'
import {
  automationChangePublications,
  type AutomationChangeSelector,
  type AutomationListResult
} from '../../../../shared/automation-list-scope'
import { OrchestrationDb } from '../../orchestration/db'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { getAppEnvironment } from '../../../../shared/app-environment'
import type { LegacyWorkerTerminalRecoveryPlan } from '../../orchestration/orchestration-legacy-worker-terminal-recovery'
import type { LegacyWorkerTerminalRecoveryResult } from '../../runtime-legacy-worker-terminal-recovery-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type {
  AgentsWorkflowCreateInput,
  AgentsWorkflowDefinition,
  AgentsWorkflowUpdateFields
} from '../../../../shared/agents-workflow-types'
import type {
  AgentsWorkflowRun,
  AgentsWorkflowRunsPage
} from '../../../../shared/agents-workflow-run-types'
import { AgentsWorkflowRunService } from '../../../agents-workflow/workflow-run-service'
import { createStructuredAgentsWorkflowExecutionAdapter } from '../../../agents-workflow/workflow-agent-execution-adapter'
import { createWorkflowStructuredTurnRunner } from '../../../agents-workflow/workflow-structured-turn-runner'
import { createAgentsWorkflowWorkspaceResolver } from '../../../agents-workflow/workflow-workspace-resolver'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { worktreeIdsEqual } from '../../../../shared/worktree/id'

export abstract class OrcaRuntimeWithAutomationOperations extends OrcaRuntimeWithPtyForegroundProcessReads {
  private agentsWorkflowRunService: AgentsWorkflowRunService | null = null
  abstract notifyAutomationsChanged(payload?: AutomationsChangedPayload): void
  abstract ensureOrchestrationFederationRelay(runId?: string): void
  protected abstract scheduleRestoredMessageRepoints(): void
  protected abstract getResolvedWorktreeMap(): Promise<Map<string, ResolvedWorktree>>
  protected abstract getLeafKey(tabId: string, leafId: string): string

  private readAutomationRuns<T>(
    automationId: string | undefined,
    expectedOwner: AutomationOwnerPrecondition | undefined,
    read: () => T
  ): T {
    if (expectedOwner && !automationId) {
      throw new Error('An expected owner requires an automation id.')
    }
    return this.automation.withExternalProbePriority(() => {
      if (automationId) {
        this.automation.assertOwner(automationId, expectedOwner, 'read')
      }
      return read()
    })
  }

  listAutomationRuns(
    automationId?: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): AutomationRun[] {
    return this.readAutomationRuns(automationId, expectedOwner, () =>
      this.automation.listRuns(automationId)
    )
  }

  listAutomationRunsPage(
    automationId?: string,
    expectedOwner?: AutomationOwnerPrecondition,
    limit?: number,
    cursor?: string
  ) {
    return this.readAutomationRuns(automationId, expectedOwner, () =>
      this.automation.listRunsPage(automationId, limit, cursor)
    )
  }

  showAutomation(id: string, expectedOwner?: AutomationOwnerPrecondition): Automation {
    const automation = this.automation.show(id)
    this.automation.assertOwner(id, expectedOwner, 'read')
    return automation
  }

  protected automationChangeSelector(id: string): AutomationChangeSelector | null {
    return this.store?.automationChangeSelector?.(id) ?? null
  }

  /** A store that cannot name the affected host degrades to one unscoped authority event. */
  protected publishAutomationDefinitionChange(
    before: AutomationChangeSelector | null,
    after: AutomationChangeSelector | null
  ): void {
    for (const selector of automationChangePublications(before, after)) {
      this.notifyAutomationsChanged({ reason: 'definition', ...(selector ? { selector } : {}) })
    }
  }

  createAutomation(
    input: RuntimeAutomationCreateInput,
    destination?: AutomationDestination
  ): Promise<Automation> {
    return this.automation.withExternalProbePriority(() =>
      this.automation.create(input, destination).then((automation) => {
        const selector = this.automationChangeSelector(automation.id)
        this.publishAutomationDefinitionChange(selector, selector)
        return automation
      })
    )
  }

  updateAutomation(
    id: string,
    updates: RuntimeAutomationUpdateInput,
    options?: { expectedOwner?: AutomationOwnerPrecondition; destination?: AutomationDestination }
  ): Promise<Automation> {
    return this.automation.withExternalProbePriority(() => {
      const source = this.automationChangeSelector(id)
      return this.automation.update(id, updates, options).then((automation) => {
        this.publishAutomationDefinitionChange(source, this.automationChangeSelector(automation.id))
        return automation
      })
    })
  }

  deleteAutomation(
    id: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): Promise<{ removed: boolean; id: string }> {
    return this.automation.withExternalProbePriority(() => {
      const selector = this.automationChangeSelector(id)
      return this.automation.delete(id, expectedOwner).then((result) => {
        this.publishAutomationDefinitionChange(selector, selector)
        return result
      })
    })
  }

  runAutomationNow(
    id: string,
    expectedOwner?: AutomationOwnerPrecondition
  ): Promise<AutomationRun> {
    return this.automation.withExternalProbePriority(() =>
      this.automation.runNow(id, expectedOwner)
    )
  }

  listAutomationsForScope(params = {}): AutomationListResult {
    return this.automation.withExternalProbePriority(() => this.automation.listForScope(params))
  }

  automationOwnerPrecondition(id: string): AutomationOwnerPrecondition | null {
    return this.automation.ownerPrecondition(id)
  }

  listAgentsWorkflows(): AgentsWorkflowDefinition[] {
    if (!this.store?.listAgentsWorkflows) {
      throw new Error('runtime_unavailable')
    }
    return this.store.listAgentsWorkflows()
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
    input: string
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
      createStructuredAgentsWorkflowExecutionAdapter(createWorkflowStructuredTurnRunner(runtime)),
      createAgentsWorkflowWorkspaceResolver(runtime)
    )
    return this.agentsWorkflowRunService
  }

  abstract notifyAgentsWorkflowsChanged(payload?: { reason?: 'definition' | 'run' }): void

  // Why: lazy initialization — the DB path depends on Electron's userData
  // which may not be finalized until after app.ready. Also allows unit tests
  // to inject an in-memory DB without touching the filesystem.
  getOrchestrationDb(): OrchestrationDb {
    if (!this._orchestrationDb) {
      this._orchestrationDb = new OrchestrationDb(this.orchestrationDbPath())
      this.ensureOrchestrationFederationRelay()
      this.scheduleRestoredMessageRepoints()
    }
    return this._orchestrationDb
  }

  /** The database, opened only if it already exists: a profile without one has no mail to redrive. */
  getExistingOrchestrationDb(): OrchestrationDb | null {
    return this._orchestrationDb || existsSync(this.orchestrationDbPath())
      ? this.getOrchestrationDb()
      : null
  }

  private orchestrationDbPath(): string {
    return join(getAppEnvironment().getPath('userData'), 'orchestration.db')
  }

  setOrchestrationDb(db: OrchestrationDb): void {
    this.orchestrationFederation.resetForDatabaseChange()
    this.mailPointerRepointScheduler.clear()
    this._orchestrationDb = db
    this.ensureOrchestrationFederationRelay()
    this.scheduleRestoredMessageRepoints()
  }

  protected async flushWorkspaceSessionOrThrowAsync(): Promise<void> {
    const store = this.store
    if (store?.flushPendingOrThrowAsync) {
      await store.flushPendingOrThrowAsync({ drainToStableGeneration: false })
      return
    }
    if (store?.flushOrThrow) {
      store.flushOrThrow()
      return
    }
    throw new Error('workspace_session_persistence_unavailable')
  }

  async reconcileLegacyWorkerTerminals(
    options: { connectionId?: string; materializeRenderer?: boolean } = {}
  ): Promise<LegacyWorkerTerminalRecoveryResult> {
    return this.legacyWorkerRecovery.reconcile(options)
  }

  stopLegacyWorkerTerminalRecovery(): Promise<void> {
    return this.legacyWorkerRecovery.stop()
  }

  protected updateLegacyWorkerTerminalRecoveryRetry(
    plan: LegacyWorkerTerminalRecoveryPlan,
    deferredDispatchIds: ReadonlySet<string>,
    options: { connectionId?: string; materializeRenderer?: boolean }
  ): void {
    this.legacyWorkerRecovery.updateRetry(plan, deferredDispatchIds, options)
  }

  async refreshRestoredOrchestrationAuthority(connectionId: string | null = null): Promise<void> {
    if (connectionId === null && !this.canRecoverPersistentLocalPtysFn()) {
      return
    }
    const inventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
      [...(await this.getResolvedWorktreeMap()).values()],
      null,
      undefined,
      connectionId
    )
    if (!inventory) {
      throw new Error('terminal_liveness_unavailable')
    }
  }

  protected hasExactTerminalSurfaceIdentity(expected: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    terminalHandle: string
    incarnationId: string
  }): boolean {
    if (this.graphStatus !== 'ready') {
      return false
    }
    const pty = this.ptysById.get(expected.ptyId)
    if (
      !pty?.connected ||
      pty.incarnationId !== expected.incarnationId ||
      pty.tabId !== expected.tabId ||
      pty.paneKey !== makePaneKey(expected.tabId, expected.leafId) ||
      !worktreeIdsEqual(pty.worktreeId, expected.worktreeId) ||
      this.handleByPtyId.get(expected.ptyId) !== expected.terminalHandle
    ) {
      return false
    }
    const tab = this.tabs.get(expected.tabId)
    const leaf = this.leaves.get(this.getLeafKey(expected.tabId, expected.leafId))
    const ptyLeaves = this.getLeavesForPty(expected.ptyId)
    return (
      Boolean(tab && worktreeIdsEqual(tab.worktreeId, expected.worktreeId)) &&
      Boolean(
        leaf &&
        leaf.ptyId === expected.ptyId &&
        worktreeIdsEqual(leaf.worktreeId, expected.worktreeId)
      ) &&
      ptyLeaves.length === 1 &&
      ptyLeaves[0]?.tabId === expected.tabId &&
      ptyLeaves[0]?.leafId === expected.leafId
    )
  }
}
