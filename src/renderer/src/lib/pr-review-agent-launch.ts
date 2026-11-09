import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTab } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-session/launch/routing/agent-launch-request-id'
import { resolveDefaultAgentForWorktreeNewTab } from '@/lib/agent-tab-shortcuts'
import { findGithubPrWorkspaceAttachment } from '@/lib/work-items/github/github-work-item-workspace-attachment'
import { findGitLabMrWorkspaceAttachment } from '@/lib/gitlab-work-item-workspace-attachment'
import {
  buildReviewMergeRequestPrompt,
  buildReviewPullRequestPrompt
} from '../../../shared/pr-review-prompt'
import type { GitHubWorkItem } from '../../../shared/github/work-item-types'
import type { GitLabWorkItem } from '../../../shared/gitlab-types'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { Worktree } from '../../../shared/worktree/types'

/** Reuse a workspace the user already has: the review's own workspace, else the repository's main checkout. */
export function resolveReviewWorktreeId(
  worktrees: readonly Worktree[],
  repoId: string,
  findAttached: (worktrees: readonly Worktree[], repoId: string) => Worktree | null
): string | null {
  const attached = findAttached(worktrees, repoId)
  if (attached) {
    return attached.id
  }
  const repoWorktrees = worktrees.filter(
    (worktree) => worktree.repoId === repoId && !worktree.isArchived
  )
  return (repoWorktrees.find((worktree) => worktree.isMainWorktree) ?? repoWorktrees[0])?.id ?? null
}

export function resolvePrReviewWorktreeId(
  worktrees: readonly Worktree[],
  repoId: string,
  item: Pick<GitHubWorkItem, 'number' | 'url'>
): string | null {
  return resolveReviewWorktreeId(worktrees, repoId, (all, id) =>
    findGithubPrWorkspaceAttachment(all, id, item.number, item.url)
  )
}

export function resolveMrReviewWorktreeId(
  worktrees: readonly Worktree[],
  repoId: string,
  item: Pick<GitLabWorkItem, 'number' | 'url'>
): string | null {
  return resolveReviewWorktreeId(worktrees, repoId, (all, id) =>
    findGitLabMrWorkspaceAttachment(all, id, item.number, item.url)
  )
}

/** Runs the review in an existing workspace; the prompt reads the review from the provider, so no checkout is created. */
async function launchReviewAgent<Item>(args: {
  item: Item
  repoId: string
  launchSource: LaunchSource
  openModalFallback?: () => void
  resolveWorktreeId: (worktrees: readonly Worktree[], repoId: string) => string | null
  buildPrompt: (item: Item) => string
  startedMessage: string
}): Promise<boolean> {
  const worktreeId = args.resolveWorktreeId(useAppStore.getState().allWorktrees(), args.repoId)
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
    prompt: args.buildPrompt(args.item),
    promptDelivery: 'submit-after-ready',
    launchSource: args.launchSource
  })
  toast.success(args.startedMessage)
  return true
}

export async function startPrReviewAgent(args: {
  item: GitHubWorkItem
  repoId: string
  launchSource: LaunchSource
  openModalFallback?: () => void
}): Promise<boolean> {
  return launchReviewAgent({
    item: args.item,
    repoId: args.repoId,
    launchSource: args.launchSource,
    openModalFallback: args.openModalFallback,
    resolveWorktreeId: (worktrees, repoId) =>
      resolvePrReviewWorktreeId(worktrees, repoId, args.item),
    buildPrompt: (item) =>
      buildReviewPullRequestPrompt({
        number: item.number,
        title: item.title,
        url: item.url,
        baseRef: item.baseRefName ?? null,
        headSha: item.headSha ?? null
      }),
    startedMessage: translate(
      'auto.lib.pr.review.agent.launch.started',
      'Started a review agent for PR #{{value0}}.',
      { value0: args.item.number }
    )
  })
}

export async function startMergeRequestReviewAgent(args: {
  item: GitLabWorkItem
  repoId: string
  launchSource: LaunchSource
  openModalFallback?: () => void
}): Promise<boolean> {
  return launchReviewAgent({
    item: args.item,
    repoId: args.repoId,
    launchSource: args.launchSource,
    openModalFallback: args.openModalFallback,
    resolveWorktreeId: (worktrees, repoId) =>
      resolveMrReviewWorktreeId(worktrees, repoId, args.item),
    buildPrompt: (item) =>
      buildReviewMergeRequestPrompt({
        number: item.number,
        title: item.title,
        url: item.url,
        baseRef: item.baseRefName ?? null,
        headSha: null
      }),
    startedMessage: translate(
      'auto.lib.gitlab.review.agent.launch.started',
      'Started a review agent for MR !{{value0}}.',
      { value0: args.item.number }
    )
  })
}
