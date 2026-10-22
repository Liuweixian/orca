import { normalizePersistedMobileClientTabSelections } from '../../runtime/client-session-tab-selection-persistence'
import type { SshRemotePtyLease } from '../../../shared/ssh-types'
import { normalizeFeatureInteractionTelemetryBuckets } from '../../../shared/feature-interactions'
import { normalizeFolderWorkspaceDiffComments } from '../../folder-workspace-diff-comments'
import { normalizeFolderWorkspaces } from '../../../shared/folder-workspaces'
import { normalizeOrcadMigrationEvictedReceipts } from '../../../shared/orcad-migration/orcad-migration-evicted-receipts'
import { normalizeOrcadMigrationImportReceipts } from '../../../shared/orcad-migration/orcad-migration-manifest-validation'
import { normalizeOrcadMigrationStagedCatalogs } from '../../../shared/orcad-migration/orcad-migration-staged-catalog-validation'
import { normalizeWorkspaceLineageByChildKey } from '../applying-settings/ui-interaction-merge'
import {
  normalizeSshRemotePtyLease,
  normalizeSshTarget
} from '../leasing-ssh-ptys/ssh-normalization'
import { migrateExistingHostsRemoteCliControl } from '../leasing-ssh-ptys/ssh-remote-cli-control-migration'
import {
  normalizeLegacyPaneKeyAliasEntries,
  normalizeMigrationUnsupportedPtyEntries
} from '../restoring-sessions/pane-alias-normalization'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { PreparedLoadedTerminalSettings } from './prepare-loaded-terminal-settings'
import type { PreparedLoadedProfileSettings } from './prepare-loaded-profile-settings'
import { normalizeLoadedGlobalSettings } from './normalize-loaded-global-settings'
import { normalizeLoadedUiState } from './normalize-loaded-ui-state'
import {
  normalizeLoadedAutomationRuns,
  normalizeLoadedHostSessions,
  normalizeLoadedLocalSession,
  normalizeLoadedProjectCatalog
} from './normalize-loaded-state-collections'
import { normalizeRetiredNameRegistryMap } from './retired-name-registry-normalization'
import { hydrateWorktreeMetaAliasProjection } from './worktree-meta-alias-projection'
import { AgentsWorkflowDefinitionSchema } from '../../../shared/agents-workflow-types'
import { AgentsWorkflowRunSchema } from '../../../shared/agents-workflow-run-types'
import {
  migrateLegacyAgentsWorkflowDefinition,
  migrateLegacyAgentsWorkflowRun
} from './agents-workflow-legacy-migration'

function normalizeAgentsWorkflows(value: unknown): PersistedState['agentsWorkflows'] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) => {
    const parsed = AgentsWorkflowDefinitionSchema.safeParse(
      migrateLegacyAgentsWorkflowDefinition(entry)
    )
    if (!parsed.success) {
      // Why log: silently dropping a workflow looks like data loss to the user.
      console.warn('[agents-workflow] Dropped an unreadable workflow definition:', parsed.error)
      return []
    }
    return [parsed.data]
  })
}

function normalizeAgentsWorkflowRuns(
  value: unknown,
  markNeedsSave: () => void
): PersistedState['agentsWorkflowRuns'] {
  if (!Array.isArray(value)) {
    return []
  }
  const now = Date.now()
  return value.flatMap((entry) => {
    const parsed = AgentsWorkflowRunSchema.safeParse(migrateLegacyAgentsWorkflowRun(entry))
    if (!parsed.success) {
      console.warn('[agents-workflow] Dropped an unreadable workflow run:', parsed.error)
      return []
    }
    if (
      parsed.data.status !== 'pending' &&
      parsed.data.status !== 'running' &&
      parsed.data.status !== 'cancel_requested'
    ) {
      return [parsed.data]
    }
    markNeedsSave()
    return [
      {
        ...parsed.data,
        status: 'unverifiable' as const,
        finishedAt: now,
        errorCode: 'execution_evidence_lost',
        errorMessage: 'The app restarted without reliable process-exit evidence.',
        attempts: parsed.data.attempts.map((attempt) =>
          attempt.status === 'running' || attempt.status === 'pending'
            ? { ...attempt, status: 'unverifiable' as const, finishedAt: now }
            : attempt
        )
      }
    ]
  })
}

export function normalizeLoadedProfileState(
  parsed: PersistedState,
  terminal: PreparedLoadedTerminalSettings,
  profile: PreparedLoadedProfileSettings,
  markNeedsSave: () => void
): PersistedState {
  const { defaults, migratedExternalVisibility, osc52ClipboardNoticePending } = terminal
  const { normalizedOnboarding, normalizedProjectGroups, loadedCompactWorktreeCards } = profile
  const projectCatalog = normalizeLoadedProjectCatalog(parsed, markNeedsSave)
  // Ordered: the host partitions drop the global fields this slice already owns.
  const workspaceSession = normalizeLoadedLocalSession(parsed, defaults, markNeedsSave)

  return {
    ...defaults,
    ...parsed,
    featureInteractionTelemetryBuckets: normalizeFeatureInteractionTelemetryBuckets(
      parsed.featureInteractionTelemetryBuckets
    ),
    projectGroups: normalizedProjectGroups,
    repos: migratedExternalVisibility.repos,
    // Why: persisted catalog rows are untrusted JSON; consumers call string methods on fields the type says are strings.
    projects: projectCatalog.projects,
    projectHostSetups: projectCatalog.projectHostSetups,
    folderWorkspaces: normalizeFolderWorkspaces(parsed.folderWorkspaces, normalizedProjectGroups),
    folderWorkspaceDiffComments: normalizeFolderWorkspaceDiffComments(
      parsed.folderWorkspaceDiffComments
    ),
    // Rebuilds the identity rows the serializer left to the locator map, and restores the shared
    // object reference JSON.parse splits. Not `markNeedsSave`: this IS the canonical on-disk shape.
    // Conditional so a file with no identity map keeps none, rather than gaining an own key whose
    // value is `undefined`.
    ...(parsed.worktreeMetaByIdentity === undefined
      ? {}
      : { worktreeMetaByIdentity: hydrateWorktreeMetaAliasProjection(parsed) }),
    worktreeLineageById: parsed.worktreeLineageById ?? {},
    mobileClientTabSelectionsByDeviceId: normalizePersistedMobileClientTabSelections(
      parsed.mobileClientTabSelectionsByDeviceId
    ),
    workspaceLineageByChildKey: normalizeWorkspaceLineageByChildKey(
      parsed.workspaceLineageByChildKey
    ),
    settings: normalizeLoadedGlobalSettings(parsed, terminal, profile),
    // Why: legacy 'recent' meant the smart sort; migrate once on the raw value so a fresh 'recent' default isn't remigrated.
    ui: normalizeLoadedUiState(
      parsed,
      defaults,
      normalizedOnboarding,
      loadedCompactWorktreeCards,
      osc52ClipboardNoticePending,
      markNeedsSave
    ),
    // Why: volatile schema; zod-validate workspaceSession at read so a bad payload falls to defaults, not a renderer crash.
    workspaceSession,
    // Why: per-host session partitions, validated independently; 'local' stays in workspaceSession for downgrade compat.
    workspaceSessionsByHostId: normalizeLoadedHostSessions(
      parsed,
      defaults,
      workspaceSession,
      markNeedsSave
    ),
    sshTargets: migrateExistingHostsRemoteCliControl(
      (parsed.sshTargets ?? []).map(normalizeSshTarget),
      parsed.settings?.sshRemoteCliControlExistingHostsMigrated === true,
      markNeedsSave
    ),
    deletedSshConfigAliases: Array.isArray(parsed.deletedSshConfigAliases)
      ? parsed.deletedSshConfigAliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
    retiredWorktreeNamesByRepo: normalizeRetiredNameRegistryMap(parsed.retiredWorktreeNamesByRepo),
    retiredWorktreeNamesByNamespace: normalizeRetiredNameRegistryMap(
      parsed.retiredWorktreeNamesByNamespace
    ),
    sshRemotePtyLeases: (parsed.sshRemotePtyLeases ?? [])
      .map(normalizeSshRemotePtyLease)
      .filter((lease): lease is SshRemotePtyLease => lease !== null),
    sshPtyConsumerRecoveries: parsed.sshPtyConsumerRecoveries,
    migrationUnsupportedPtyEntries: normalizeMigrationUnsupportedPtyEntries(
      parsed.migrationUnsupportedPtyEntries
    ),
    legacyPaneKeyAliasEntries: normalizeLegacyPaneKeyAliasEntries(parsed.legacyPaneKeyAliasEntries),
    automations: Array.isArray(parsed.automations) ? parsed.automations : [],
    automationRuns: normalizeLoadedAutomationRuns(parsed, markNeedsSave),
    agentsWorkflows: normalizeAgentsWorkflows(parsed.agentsWorkflows),
    agentsWorkflowRuns: normalizeAgentsWorkflowRuns(parsed.agentsWorkflowRuns, markNeedsSave),
    orcadMigrationImportReceipts: normalizeOrcadMigrationImportReceipts(
      parsed.orcadMigrationImportReceipts
    ),
    orcadMigrationEvictedReceipts: normalizeOrcadMigrationEvictedReceipts(
      parsed.orcadMigrationEvictedReceipts
    ),
    orcadMigrationStagedCatalogs: normalizeOrcadMigrationStagedCatalogs(
      parsed.orcadMigrationStagedCatalogs
    ),
    onboarding: normalizedOnboarding
  }
}
