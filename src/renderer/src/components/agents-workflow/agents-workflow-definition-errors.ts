import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  AGENTS_WORKFLOW_DEFINITION_INVALID,
  AGENTS_WORKFLOW_REVISION_CONFLICT
} from '../../../../shared/agents-workflow-errors'

/** The write lost a revision race, so the page must reload before it can try again. */
export function isRevisionConflict(error: unknown): boolean {
  return error instanceof RuntimeRpcCallError && error.code === AGENTS_WORKFLOW_REVISION_CONFLICT
}

/**
 * Surfaces a rejected definition write. The host refuses invalid graphs, so its issue list is the
 * most useful error the user can get; anything else is a generic failure.
 */
export function reportDefinitionFailure(error: unknown, fallback: string): void {
  const issues =
    error instanceof RuntimeRpcCallError && error.code === AGENTS_WORKFLOW_DEFINITION_INVALID
      ? definitionIssues(error.response.error.data)
      : []
  if (issues.length === 0) {
    toast.error(fallback)
    return
  }
  toast.error(
    translate(
      'auto.components.agents-workflow.controller.invalid',
      'Fix these before saving: {{issues}}',
      { issues: issues.join('; ') }
    )
  )
}

function definitionIssues(data: unknown): string[] {
  if (typeof data !== 'object' || data === null || !('issues' in data)) {
    return []
  }
  const issues = data.issues
  if (!Array.isArray(issues)) {
    return []
  }
  return issues.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null || !('message' in issue)) {
      return []
    }
    const message = issue.message
    return typeof message === 'string' ? [message] : []
  })
}
