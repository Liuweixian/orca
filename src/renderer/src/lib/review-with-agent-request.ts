import type { GitHubWorkItem } from '../../../shared/github/work-item-types'
import type { GitLabWorkItem } from '../../../shared/gitlab-types'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { Worktree } from '../../../shared/worktree/types'

export type ReviewWithAgentRequest = {
  provider: 'github' | 'gitlab'
  item: GitHubWorkItem | GitLabWorkItem
  repoId: string
  /** Workspace the review defaults to; the dialog lets the user pick another repo workspace. */
  preferredWorktreeId: string | null
  launchSource: LaunchSource
}

/** Modal data crosses a Record boundary, so the dialog re-checks the shape it opened with. */
export function readReviewWithAgentRequest(
  modalData: Record<string, unknown>
): ReviewWithAgentRequest | null {
  const request = modalData.request
  if (typeof request !== 'object' || request === null) {
    return null
  }
  const candidate = request as Partial<ReviewWithAgentRequest>
  return candidate.provider && candidate.item && typeof candidate.repoId === 'string'
    ? (candidate as ReviewWithAgentRequest)
    : null
}

/** Main checkout first so the default reads as "review in this repo", then the rest by name. */
export function reviewWorktreeOptions(worktrees: readonly Worktree[], repoId: string): Worktree[] {
  return worktrees
    .filter((worktree) => worktree.repoId === repoId && !worktree.isArchived && !worktree.removing)
    .sort((left, right) =>
      left.isMainWorktree === right.isMainWorktree
        ? left.displayName.localeCompare(right.displayName)
        : left.isMainWorktree
          ? -1
          : 1
    )
}
