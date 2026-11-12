import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/slices/worktrees/listing/use-worktree-catalog'
import { acquireAgentLaunchChoices } from '@/lib/host-chat-program-acquisition'
import { worktreeLaunchWorkspace } from '@/lib/agent-session/launch/routing/agent-launch-route-input'
import { ensureDetectedAgentsForWorktree } from '@/lib/agent-detection-target-inventory'
import { resolveDefaultAgentForWorktreeNewTab } from '@/lib/agent-tab-shortcuts'
import { startMergeRequestReviewAgent, startPrReviewAgent } from '@/lib/pr-review-agent-launch'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent'
import { readReviewWithAgentRequest, reviewWorktreeOptions } from '@/lib/review-with-agent-request'

const ReviewWithAgentDialog = React.memo(
  function ReviewWithAgentDialog(): React.JSX.Element | null {
    const t = useTranslate()
    const modalData = useAppStore((s) => s.modalData)
    const closeModal = useAppStore((s) => s.closeModal)
    const allWorktrees = useAllWorktrees()
    const request = readReviewWithAgentRequest(modalData)
    const worktrees = useMemo(
      () => (request ? reviewWorktreeOptions(allWorktrees, request.repoId) : []),
      [allWorktrees, request]
    )
    const preferredWorktreeId =
      worktrees.find((worktree) => worktree.id === request?.preferredWorktreeId)?.id ?? null
    const [worktreeId, setWorktreeId] = useState<string | null>(
      preferredWorktreeId ?? worktrees[0]?.id ?? null
    )
    const [agents, setAgents] = useState<TuiAgent[] | null>(null)
    const [agent, setAgent] = useState<TuiAgent | null>(null)

    // The worktree catalog can arrive after the modal opens; seed the first candidate once it does.
    useEffect(() => {
      if (!worktreeId && worktrees.length > 0) {
        setWorktreeId(worktrees[0].id)
      }
    }, [worktreeId, worktrees])

    useEffect(() => {
      if (!worktreeId) {
        setAgents([])
        setAgent(null)
        return
      }
      let cancelled = false
      setAgents(null)
      setAgent(null)
      const workspace = worktreeLaunchWorkspace(worktreeId)
      void Promise.all([
        acquireAgentLaunchChoices(workspace, () =>
          ensureDetectedAgentsForWorktree(useAppStore.getState(), worktreeId)
        ),
        resolveDefaultAgentForWorktreeNewTab(() => useAppStore.getState(), worktreeId)
      ])
        .then(([choices, preferred]) => {
          if (cancelled) {
            return
          }
          const offered = choices.offered
          setAgents(offered)
          // Codely reviews first when it is available; the workspace default is only the fallback.
          setAgent(
            offered.includes('codely')
              ? 'codely'
              : preferred && offered.includes(preferred)
                ? preferred
                : (offered[0] ?? null)
          )
        })
        .catch(() => {
          if (!cancelled) {
            setAgents([])
          }
        })
      return () => {
        cancelled = true
      }
    }, [worktreeId])

    const start = useCallback(() => {
      if (!request || !worktreeId || !agent) {
        return
      }
      const started =
        request.provider === 'github'
          ? startPrReviewAgent({
              item: request.item as Parameters<typeof startPrReviewAgent>[0]['item'],
              worktreeId,
              agent,
              launchSource: request.launchSource
            })
          : startMergeRequestReviewAgent({
              item: request.item as Parameters<typeof startMergeRequestReviewAgent>[0]['item'],
              worktreeId,
              agent,
              launchSource: request.launchSource
            })
      if (started) {
        closeModal()
      }
    }, [agent, closeModal, request, worktreeId])

    if (!request) {
      return null
    }

    const reference =
      request.provider === 'github' ? `#${request.item.number}` : `!${request.item.number}`
    const reviewLabel = request.provider === 'github' ? 'pull request' : 'merge request'
    const loadingAgents = agents === null
    const selectedWorktree = worktrees.find((worktree) => worktree.id === worktreeId) ?? null

    return (
      <Dialog open onOpenChange={(next) => !next && closeModal()}>
        <DialogContent surface="security" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('auto.components.ReviewWithAgentDialog.title', 'Review with agent')}
            </DialogTitle>
            <DialogDescription size="compact">
              {t(
                'auto.components.ReviewWithAgentDialog.description',
                'Choose the workspace to review in and the agent that runs the review of {{reference}}.',
                { reference }
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="review-with-agent-worktree">
                {t('auto.components.ReviewWithAgentDialog.workspace', 'Workspace')}
              </Label>
              <Select
                value={worktreeId ?? ''}
                onValueChange={(next) => next && setWorktreeId(next)}
                disabled={worktrees.length === 0}
              >
                <SelectTrigger id="review-with-agent-worktree" className="w-full">
                  <SelectValue
                    placeholder={t(
                      'auto.components.ReviewWithAgentDialog.noWorkspace',
                      'No workspace for this repository'
                    )}
                  >
                    {selectedWorktree?.displayName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {worktrees.map((worktree) => (
                    <SelectItem key={worktree.id} value={worktree.id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{worktree.displayName}</span>
                        <span className="truncate text-muted-foreground">{worktree.branch}</span>
                        {worktree.isMainWorktree ? (
                          <span className="text-2xs text-muted-foreground">
                            {t(
                              'auto.components.ReviewWithAgentDialog.mainCheckout',
                              'Main checkout'
                            )}
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="review-with-agent-agent">
                {t('auto.components.ReviewWithAgentDialog.agent', 'Agent')}
              </Label>
              <Select
                value={agent ?? ''}
                onValueChange={(next) => next && setAgent(next as TuiAgent)}
                disabled={loadingAgents || (agents?.length ?? 0) === 0}
              >
                <SelectTrigger id="review-with-agent-agent" className="w-full">
                  <SelectValue
                    placeholder={
                      loadingAgents
                        ? t(
                            'auto.components.ReviewWithAgentDialog.loadingAgents',
                            'Looking for agents…'
                          )
                        : t(
                            'auto.lib.pr.review.agent.launch.noAgent',
                            'No enabled AI agent was detected on this workspace host.'
                          )
                    }
                  >
                    {agent ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <AgentIcon agent={agent} size={14} />
                        <span className="truncate">{getAgentLabel(agent)}</span>
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      <span className="flex min-w-0 items-center gap-2">
                        <AgentIcon agent={candidate} size={14} />
                        <span className="truncate">{getAgentLabel(candidate)}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'auto.components.ReviewWithAgentDialog.checkoutNotice',
                'The agent switches this workspace to the {{reviewLabel}} head branch for the review, then returns it to the branch it started on.',
                { reviewLabel }
              )}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeModal}>
              {t('auto.components.ReviewWithAgentDialog.cancel', 'Cancel')}
            </Button>
            <Button onClick={start} disabled={!worktreeId || !agent}>
              {t('auto.components.ReviewWithAgentDialog.start', 'Start review')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
)

export default ReviewWithAgentDialog
