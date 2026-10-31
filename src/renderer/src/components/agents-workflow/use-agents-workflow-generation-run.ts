// Owns a generation after the dialog closes.
//
// The design turn runs in the user's checkout for as long as the agent needs, so the dialog hands
// it here and closes: a modal that must stay open to keep the work alive is a trap, since closing it
// is the only way out and closing it would throw the turn away.

import React from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import type { AgentsWorkflowGenerationDraft } from '../../../../shared/agents-workflow-generation'
import {
  beginAgentsWorkflowGeneration,
  endAgentsWorkflowGeneration,
  holdAgentsWorkflowGeneratedDraft,
  isAgentsWorkflowGenerating,
  subscribeAgentsWorkflowGeneration
} from './agents-workflow-generated-drafts'
import { generateAgentsWorkflow } from './agents-workflow-rpc-client'

export type AgentsWorkflowGenerationRequest = {
  request: string
  workspaceId: string
  agentId: TuiAgent
  agentIds: TuiAgent[]
}

export type AgentsWorkflowGenerationRun = {
  /** A design turn for this workflow is still running, even if this page was remounted. */
  generating: boolean
  start: (request: AgentsWorkflowGenerationRequest) => void
}

export function useAgentsWorkflowGenerationRun(input: {
  definition: AgentsWorkflowDefinition
  dirty: boolean
  /** The graph replaced the user's, or the same graph when nothing was unsaved. */
  onApply: (draft: AgentsWorkflowGenerationDraft) => void
  /** Unsaved edits are on screen, so the replacement waits for the user to say yes. */
  onAskReplace: (draft: AgentsWorkflowGenerationDraft) => void
}): AgentsWorkflowGenerationRun {
  const workflowId = input.definition.id
  // Why the module store: watching the agent is done by switching to its chat, which unmounts this
  // page, so a per-component flag forgot the turn and let the page start a second one.
  const generating = React.useSyncExternalStore(
    subscribeAgentsWorkflowGeneration,
    () => isAgentsWorkflowGenerating(workflowId),
    () => false
  )
  /** Read at settle time: the page may have switched workflows or saved while the agent worked. */
  const latest = React.useRef(input)
  latest.current = input
  const inFlight = React.useRef<string | null>(null)

  // Why no cancel on unmount: watching the agent is done by switching to its chat, which unmounts
  // this page. Cancelling there killed the very turn the user went to look at. The host's own
  // timeout still bounds a generation nobody comes back for.
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const start = React.useCallback((request: AgentsWorkflowGenerationRequest) => {
    const designedFor = latest.current.definition.id
    if (inFlight.current !== null || isAgentsWorkflowGenerating(designedFor)) {
      return
    }
    inFlight.current = designedFor
    beginAgentsWorkflowGeneration(designedFor)
    const notice = toast.message(
      translate('auto.components.agents-workflow.generation.designing', 'Designing the workflow…')
    )
    void generateAgentsWorkflow(request)
      .then(({ draft }) => {
        // Why this guard: a result that no longer belongs to this run must not touch any graph.
        if (inFlight.current !== designedFor) {
          return
        }
        const current = latest.current
        // Why hold instead of drop: the design is for a workflow that is not on screen right now
        // (the page is gone, or the user moved on), so it waits for that workflow's surface.
        if (!mounted.current || current.definition.id !== designedFor) {
          holdAgentsWorkflowGeneratedDraft(designedFor, draft)
          return
        }
        if (current.dirty) {
          current.onAskReplace(draft)
        } else {
          current.onApply(draft)
        }
      })
      .catch((error: unknown) => {
        if (inFlight.current !== designedFor || !mounted.current) {
          return
        }
        toast.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        toast.dismiss(notice)
        if (inFlight.current !== designedFor) {
          return
        }
        inFlight.current = null
        // Why always, even unmounted: the next page for this workflow must be able to start again.
        endAgentsWorkflowGeneration(designedFor)
      })
  }, [])

  return { generating, start }
}
