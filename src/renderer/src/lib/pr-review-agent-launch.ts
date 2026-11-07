import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { resolveDefaultAgentForWorktreeNewTab } from '@/lib/agent-tab-shortcuts'
import { findGithubPrWorkspaceAttachment } from '@/lib/github-work-item-workspace-attachment'
import { buildReviewPullRequestPrompt } from '../../../shared/pr-review-prompt'
import type { GitHubWorkItem } from '../../../shared/github/work-item-types'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { Worktree } from '../../../shared/worktree/types'

/** Reuse a workspace the user already has: the PR's own workspace, else the repository's main checkout. */
export function resolvePrReviewWorktreeId(
  worktrees: readonly Worktree[],
  repoId: string,
  item: Pick<GitHubWorkItem, 'number' | 'url'>
): string | null {
  const attached = findGithubPrWorkspaceAttachment(worktrees, repoId, item.number, item.url)
  if (attached) {
    return attached.id
  }
  const repoWorktrees = worktrees.filter(
    (worktree) => worktree.repoId === repoId && !worktree.isArchived
  )
  return (repoWorktrees.find((worktree) => worktree.isMainWorktree) ?? repoWorktrees[0])?.id ?? null
}

/** Runs the review in an existing workspace; the prompt reads the pull request from the provider, so no checkout is created. */
export async function startPrReviewAgent(args: {
  item: GitHubWorkItem
  repoId: string
  launchSource: LaunchSource
  openModalFallback?: () => void
}): Promise<boolean> {
  const worktreeId = resolvePrReviewWorktreeId(
    useAppStore.getState().allWorktrees(),
    args.repoId,
    args.item
  )
  if (!worktreeId) {
    toast.error(
      translate(
        'auto.lib.pr.review.agent.launch.noWorkspace',
        'Review with agent needs an existing workspace for this repository.'
      )
    )
    args.openModalFallback?.()
    return false
  }
  const agent = await resolveDefaultAgentForWorktreeNewTab(() => useAppStore.getState(), worktreeId)
  if (!agent) {
    toast.error(
      translate(
        'auto.lib.pr.review.agent.launch.noAgent',
        'No enabled AI agent was detected on this workspace host.'
      )
    )
    return false
  }
  launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent,
    worktreeId,
    prompt: buildReviewPullRequestPrompt({
      number: args.item.number,
      title: args.item.title,
      url: args.item.url,
      baseRef: args.item.baseRefName ?? null,
      headSha: args.item.headSha ?? null
    }),
    promptDelivery: 'submit-after-ready',
    launchSource: args.launchSource
  })
  toast.success(
    translate(
      'auto.lib.pr.review.agent.launch.started',
      'Started a review agent for PR #{{value0}}.',
      {
        value0: args.item.number
      }
    )
  )
  return true
}
