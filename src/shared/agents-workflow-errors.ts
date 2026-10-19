export const AGENTS_WORKFLOW_REVISION_CONFLICT = 'agents_workflow_revision_conflict'
export const AGENTS_WORKFLOW_RUN_CONFLICT = 'agents_workflow_run_conflict'

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
