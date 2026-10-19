import type Database from '../../sqlite/sync-database'
import { AgentsWorkflowRunSchema } from '../../../shared/agents-workflow-run-types'

export const PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE = 'profile_state_agents_workflow_runs'
export const AGENTS_WORKFLOW_RUNS_DOMAIN = 'agentsWorkflowRuns'

export function replaceProfileStateAgentsWorkflowRuns(
  db: Database.Database,
  payload: string | null,
  revision: number,
  updatedAt: number
): void {
  const runs = parseRuns(payload)
  db.prepare(`DELETE FROM ${PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE}`).run()
  const insert = db.prepare(
    `INSERT INTO ${PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE}
     (run_id, workflow_id, request_key, workspace_id, status, created_at, payload, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const run of runs) {
    insert.run(
      run.id,
      run.workflowId,
      run.requestKey,
      run.workspaceId,
      run.status,
      run.createdAt,
      JSON.stringify(run),
      revision,
      updatedAt
    )
  }
}

function parseRuns(payload: string | null) {
  if (payload === null) {
    return []
  }
  const value: unknown = JSON.parse(payload)
  if (!Array.isArray(value)) {
    throw new Error('Profile state agentsWorkflowRuns must be an array')
  }
  return value.map((entry) => AgentsWorkflowRunSchema.parse(entry))
}
