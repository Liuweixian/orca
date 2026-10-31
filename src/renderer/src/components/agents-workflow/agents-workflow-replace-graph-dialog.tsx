// Asks before a generated graph replaces edits the user has not saved.

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { AgentsWorkflowGenerationDraft } from '../../../../shared/agents-workflow-generation'

export function AgentsWorkflowReplaceGraphDialog({
  draft,
  onCancel,
  onReplace
}: {
  /** The design waiting for the answer; null while nothing is pending. */
  draft: AgentsWorkflowGenerationDraft | null
  onCancel: () => void
  onReplace: (draft: AgentsWorkflowGenerationDraft) => void
}): React.JSX.Element {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.agents-workflow.generation.confirmTitle',
              'Replace the current graph?'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.agents-workflow.generation.confirmGenerated',
              '{{name}} · {{nodes}} nodes. This workflow has edits that were not saved; applying the generated graph loses them.',
              { name: draft?.name ?? '', nodes: draft?.nodes.length ?? 0 }
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {translate('auto.components.agents-workflow.generation.confirmCancel', 'Keep editing')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (draft) {
                onReplace(draft)
              }
            }}
          >
            {translate('auto.components.agents-workflow.generation.confirmReplace', 'Replace')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
