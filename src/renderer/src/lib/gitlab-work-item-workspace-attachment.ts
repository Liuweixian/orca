import { foldComparableGitLabHost } from '../../../shared/git/remotes/git-remote-host-alias'
import {
  parseGitLabIssueOrMRLink,
  type ProjectSlug
} from '../../../shared/new-workspace/gitlab-links'
import { getWorkspaceAttachments } from '../../../shared/workspace-attachments/workspace-attachments'
import type { Worktree } from '../../../shared/worktree/types'

/** Host + full project path, matching how `GitRemoteIdentity.canonicalKey` is built. */
function gitLabProjectKey(slug: ProjectSlug): string {
  const host = foldComparableGitLabHost(slug.host.replace(/:\d+$/, ''))
  const path = slug.path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase()
  return `${host}/${path}`
}

export function findGitLabMrWorkspaceAttachment(
  worktrees: readonly Worktree[],
  repoId: string | null | undefined,
  mrNumber: number,
  sourceUrl?: string
): Worktree | null {
  if (!repoId) {
    return null
  }

  const source = sourceUrl ? parseGitLabIssueOrMRLink(sourceUrl) : null
  return (
    worktrees.find((worktree) => {
      if (worktree.isArchived) {
        return false
      }

      return getWorkspaceAttachments(worktree).some((item) => {
        if (item.provider !== 'gitlab' || item.type !== 'mr' || item.number !== mrNumber) {
          return false
        }
        const linked = item.url ? parseGitLabIssueOrMRLink(item.url) : null
        if (source && linked) {
          return gitLabProjectKey(source.slug) === gitLabProjectKey(linked.slug)
        }
        if (linked && !source) {
          return item.repoId === repoId && worktree.repoId === repoId
        }
        return worktree.repoId === repoId && (!item.repoId || item.repoId === repoId)
      })
    }) ?? null
  )
}
