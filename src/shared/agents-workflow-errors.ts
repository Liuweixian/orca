export const AGENTS_WORKFLOW_REVISION_CONFLICT = 'agents_workflow_revision_conflict'
export const AGENTS_WORKFLOW_RUN_CONFLICT = 'agents_workflow_run_conflict'
export const AGENTS_WORKFLOW_DEFINITION_INVALID = 'agents_workflow_definition_invalid'

export type AgentsWorkflowDefinitionIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  nodeId?: string
  edgeId?: string
}

export class AgentsWorkflowRevisionConflictError extends Error {
  readonly code = AGENTS_WORKFLOW_REVISION_CONFLICT
  readonly data: { expectedRevision: number; actualRevision: number }

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Agent workflow revision conflict (expected ${expectedRevision}, found ${actualRevision}).`
    )
    this.name = 'AgentsWorkflowRevisionConflictError'
    this.data = { expectedRevision, actualRevision }
  }
}

export class AgentsWorkflowRunConflictError extends Error {
  readonly code = AGENTS_WORKFLOW_RUN_CONFLICT
  readonly data: { workflowId: string; activeRunId: string; workspaceId: string | null }

  constructor(workflowId: string, activeRunId: string, workspaceId: string | null) {
    super('An active workflow run already owns this workflow or workspace.')
    this.name = 'AgentsWorkflowRunConflictError'
    this.data = { workflowId, activeRunId, workspaceId }
  }
}

/**
 * Why refuse the write instead of storing it: a definition that reaches the store but cannot be
 * compiled fails on every scheduled occurrence with no one watching, and the user only sees a
 * toast when they happen to press Run.
 */
export class AgentsWorkflowDefinitionInvalidError extends Error {
  readonly code = AGENTS_WORKFLOW_DEFINITION_INVALID
  readonly data: { issues: readonly AgentsWorkflowDefinitionIssue[] }

  constructor(issues: readonly AgentsWorkflowDefinitionIssue[]) {
    super(issues.map((issue) => issue.message).join('; ') || 'The workflow definition is invalid.')
    this.name = 'AgentsWorkflowDefinitionInvalidError'
    this.data = { issues }
  }
}
