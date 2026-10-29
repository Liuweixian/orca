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
import {
  AgentsWorkflowRunSchema,
  isActiveAgentsWorkflowRun
} from '../../../shared/agents-workflow-run-types'
import { markAgentsWorkflowRunInterrupted } from '../../../shared/agents-workflow-run-recovery'
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
    if (!isActiveAgentsWorkflowRun(parsed.data)) {
      return [parsed.data]
    }
    markNeedsSave()
    return [markAgentsWorkflowRunInterrupted(parsed.data, now)]
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
  // Normalize local first; host partitions drop global fields already owned here.
  const workspaceSession = normalizeLoadedLocalSession(parsed, defaults, markNeedsSave)

  return {
    ...defaults,
    ...parsed,
    featureInteractionTelemetryBuckets: normalizeFeatureInteractionTelemetryBuckets(
      parsed.featureInteractionTelemetryBuckets
    ),
    projectGroups: normalizedProjectGroups,
    repos: migratedExternalVisibility.repos,
    projects: projectCatalog.projects,
    projectHostSetups: projectCatalog.projectHostSetups,
    folderWorkspaces: normalizeFolderWorkspaces(parsed.folderWorkspaces, normalizedProjectGroups),
    folderWorkspaceDiffComments: normalizeFolderWorkspaceDiffComments(
      parsed.folderWorkspaceDiffComments
    ),
    // Rehydrate canonical aliases/shared references omitted by serialization; absence stays absent.
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
    ui: normalizeLoadedUiState(
      parsed,
      defaults,
      normalizedOnboarding,
      loadedCompactWorktreeCards,
      osc52ClipboardNoticePending,
      markNeedsSave
    ),
    workspaceSession,
    // Keep local in workspaceSession for downgrade compatibility; validate other hosts independently.
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
