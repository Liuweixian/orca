import type Database from '../../sqlite/sync-database'
import { AgentsWorkflowRunSchema } from '../../../shared/agents-workflow-run-types'

export const PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE = 'profile_state_agents_workflow_runs'
export const AGENTS_WORKFLOW_RUNS_DOMAIN = 'agentsWorkflowRuns'

/**
 * Writes the run rows the domain holds.
 *
 * Why not `DELETE` + reinsert everything: a run checkpoints after every node, so the whole history
 * was rewritten (and the WAL grown) on each node of a 20-node loop. Rows are now deleted only when
 * their run disappears, and an unchanged payload is a SQL no-op instead of a rewrite.
 */
export function replaceProfileStateAgentsWorkflowRuns(
  db: Database.Database,
  payload: string | null,
  revision: number,
  updatedAt: number
): void {
  const runs = parseRuns(payload)
  const incoming = new Set(runs.map((run) => run.id))
  const remove = db.prepare(
    `DELETE FROM ${PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE} WHERE run_id = ?`
  )
  for (const row of db
    .prepare(`SELECT run_id FROM ${PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE}`)
    .all()) {
    const runId = rowId(row)
    if (runId !== null && !incoming.has(runId)) {
      remove.run(runId)
    }
  }
  const upsert = db.prepare(
    `INSERT INTO ${PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE}
     (run_id, workflow_id, request_key, workspace_id, status, created_at, payload, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       workflow_id = excluded.workflow_id,
       request_key = excluded.request_key,
       workspace_id = excluded.workspace_id,
       status = excluded.status,
       created_at = excluded.created_at,
       payload = excluded.payload,
       revision = excluded.revision,
       updated_at = excluded.updated_at
     WHERE ${PROFILE_STATE_AGENTS_WORKFLOW_RUNS_TABLE}.payload IS NOT excluded.payload`
  )
  for (const run of runs) {
    upsert.run(
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

function rowId(row: unknown): string | null {
  if (typeof row !== 'object' || row === null || !('run_id' in row)) {
    return null
  }
  const value = row.run_id
  return typeof value === 'string' ? value : null
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
