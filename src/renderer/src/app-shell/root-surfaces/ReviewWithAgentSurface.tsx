import { lazyWithRetry as lazy } from '@/app-shell/startup/lazy-with-retry'
import { ModalBoundary } from './app-root-surface-boundaries'

const ReviewWithAgentDialog = lazy(
  () => import('../../components/review-with-agent/ReviewWithAgentDialog')
)

/**
 * Why at the root: Review with agent is opened from a PR row, a merge-request row and the task page,
 * and its capture handlers must sit above every pane those surfaces own.
 */
export function ReviewWithAgentSurface({ open }: { open: boolean }): React.JSX.Element | null {
  return open ? (
    <ModalBoundary boundaryId="modal.review-with-agent" resetKey>
      <ReviewWithAgentDialog />
    </ModalBoundary>
  ) : null
}
