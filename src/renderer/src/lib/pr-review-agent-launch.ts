import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTab } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-session/launch/routing/agent-launch-request-id'
import { findGithubPrWorkspaceAttachment } from '@/lib/work-items/github/github-work-item-workspace-attachment'
import { findGitLabMrWorkspaceAttachment } from '@/lib/gitlab-work-item-workspace-attachment'
import { reviewWorktreeOptions, type ReviewWithAgentRequest } from '@/lib/review-with-agent-request'
import {
  buildReviewMergeRequestPrompt,
  buildReviewPullRequestPrompt
} from '../../../shared/pr-review-prompt'
import type { TuiAgent } from '../../../shared/agent-launch/catalog/tui-agent'
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

/** Ask for the workspace and agent first; the review itself is launched with that explicit choice. */
function openReviewWithAgent(
  request: ReviewWithAgentRequest,
  openModalFallback?: () => void
): void {
  const state = useAppStore.getState()
  if (reviewWorktreeOptions(state.allWorktrees(), request.repoId).length === 0) {
    toast.error(
      translate(
        'auto.lib.pr.review.agent.launch.noWorkspace',
        'Review with agent needs an existing workspace for this repository.'
      )
    )
    openModalFallback?.()
    return
  }
  state.openModal('review-with-agent', { request })
}

export function openPrReviewWithAgent(args: {
  item: GitHubWorkItem
  repoId: string
  launchSource: LaunchSource
  openModalFallback?: () => void
}): void {
  openReviewWithAgent(
    {
      provider: 'github',
      item: args.item,
      repoId: args.repoId,
      preferredWorktreeId: resolvePrReviewWorktreeId(
        useAppStore.getState().allWorktrees(),
        args.repoId,
        args.item
      ),
      launchSource: args.launchSource
    },
    args.openModalFallback
  )
}

export function openMergeRequestReviewWithAgent(args: {
  item: GitLabWorkItem
  repoId: string
  launchSource: LaunchSource
  openModalFallback?: () => void
}): void {
  openReviewWithAgent(
    {
      provider: 'gitlab',
      item: args.item,
      repoId: args.repoId,
      preferredWorktreeId: resolveMrReviewWorktreeId(
        useAppStore.getState().allWorktrees(),
        args.repoId,
        args.item
      ),
      launchSource: args.launchSource
    },
    args.openModalFallback
  )
}

/** Runs the review in the chosen workspace; the prompt switches that workspace onto the review's head branch. */
function launchReviewAgent<Item>(args: {
  item: Item
  worktreeId: string
  agent: TuiAgent
  launchSource: LaunchSource
  buildPrompt: (item: Item) => string
  startedMessage: string
}): boolean {
  launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent: args.agent,
    worktreeId: args.worktreeId,
    prompt: args.buildPrompt(args.item),
    promptDelivery: 'submit-after-ready',
    launchSource: args.launchSource
  })
  toast.success(args.startedMessage)
  return true
}

export function startPrReviewAgent(args: {
  item: GitHubWorkItem
  worktreeId: string
  agent: TuiAgent
  launchSource: LaunchSource
}): boolean {
  return launchReviewAgent({
    item: args.item,
    worktreeId: args.worktreeId,
    agent: args.agent,
    launchSource: args.launchSource,
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

export function startMergeRequestReviewAgent(args: {
  item: GitLabWorkItem
  worktreeId: string
  agent: TuiAgent
  launchSource: LaunchSource
}): boolean {
  return launchReviewAgent({
    item: args.item,
    worktreeId: args.worktreeId,
    agent: args.agent,
    launchSource: args.launchSource,
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
