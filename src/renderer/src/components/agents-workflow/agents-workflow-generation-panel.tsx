// Everything the workflow page needs for one design request: the dialog, the run that outlives it,
// and the graph that lands when the agent answers.
//
// Why a panel rather than the page: the design flow is self-contained, and the page should only
// have to say "open it" and render it.

import React from 'react'
import type { AgentsWorkflowDefinition } from '../../../../shared/agents-workflow-types'
import type { AgentsWorkflowGenerationDraft } from '../../../../shared/agents-workflow-generation'
import { AgentsWorkflowGenerateDialog } from './agents-workflow-generate-dialog'
import { AgentsWorkflowReplaceGraphDialog } from './agents-workflow-replace-graph-dialog'
import { takeAgentsWorkflowGeneratedDraft } from './agents-workflow-generated-drafts'
import {
  agentsWorkflowGenerationBlocker,
  useAgentsWorkflowGenerationAgent
} from './use-agents-workflow-generation-agent'
import { useAgentsWorkflowGenerationRun } from './use-agents-workflow-generation-run'
import type { AgentsWorkflowPageController } from './use-agents-workflow-page-controller'

export type AgentsWorkflowGenerationPanel = {
  /** Opens the request dialog for the workflow on screen. */
  open: () => void
  /** Why generation is unavailable, so the trigger can explain it before the dialog opens. */
  blocker: 'workspace' | 'agent' | null
  element: React.JSX.Element
}

export function useAgentsWorkflowGenerationPanel(input: {
  controller: AgentsWorkflowPageController
  definition: AgentsWorkflowDefinition
  /** Runs just before a generated graph replaces the graph on screen. */
  onBeforeApply?: () => void
  /** The workflow on screen was just created, so designing it is the natural next step. */
  openOnMount?: boolean
}): AgentsWorkflowGenerationPanel {
  const { controller, definition, onBeforeApply, openOnMount = false } = input
  /** The user opened the dialog from the toolbar or right after creating this workflow. */
  const [openedByUser, setOpenedByUser] = React.useState(false)
  /** Auto-open was already dismissed for this workflow; it must not pop back while it is on screen. */
  const [autoOpenDismissedFor, setAutoOpenDismissedFor] = React.useState<string | null>(null)
  // Why derived: the create handoff can arrive a render after this panel mounts, and an effect that
  // opened the dialog would also reopen it every time the page re-rendered.
  const open = openedByUser || (openOnMount && autoOpenDismissedFor !== definition.id)
  /** A finished design waiting for the user to accept replacing their unsaved edits. */
  const [pendingDraft, setPendingDraft] = React.useState<AgentsWorkflowGenerationDraft | null>(null)
  // Why detection is left to the dialog: opening it is the user act that may probe this host.
  const readiness = useAgentsWorkflowGenerationAgent(definition, { ensureDetection: false })
  const blocker = agentsWorkflowGenerationBlocker(definition, readiness)

  // Why replace rather than merge: a generated graph is a whole design for the request, so mixing
  // it into an existing draft would leave edges that describe neither.
  // Why save straight away: the workflow exists as soon as it is created, so a generated graph left
  // unsaved would keep it blank on the host until the user happened to press Save.
  const applyGeneratedGraph = React.useCallback(
    (draft: AgentsWorkflowGenerationDraft) => {
      onBeforeApply?.()
      void controller.applyAndSaveWorkflow({
        ...definition,
        name: draft.name,
        nodes: draft.nodes,
        edges: draft.edges,
        updatedAt: Date.now()
      })
    },
    [controller, definition, onBeforeApply]
  )

  // Why drain here: a design that finished while another view was open is held for its workflow, so
  // it lands as soon as that workflow is on screen again.
  React.useEffect(() => {
    const held = takeAgentsWorkflowGeneratedDraft(definition.id)
    if (!held) {
      return
    }
    if (controller.dirty) {
      setPendingDraft(held)
    } else {
      applyGeneratedGraph(held)
    }
  }, [applyGeneratedGraph, controller.dirty, definition.id])

  // Why the panel owns the turn: the dialog closes as soon as the request is sent, so the run has to
  // outlive it without the user having to keep a modal open.
  const generationRun = useAgentsWorkflowGenerationRun({
    definition,
    dirty: controller.dirty,
    onApply: applyGeneratedGraph,
    onAskReplace: setPendingDraft
  })

  const openPanel = React.useCallback(() => {
    setOpenedByUser(true)
    setAutoOpenDismissedFor(null)
  }, [])
  const onOpenChange = React.useCallback(
    (next: boolean) => {
      if (next) {
        setOpenedByUser(true)
        setAutoOpenDismissedFor(null)
        return
      }
      setOpenedByUser(false)
      setAutoOpenDismissedFor((current) => current ?? definition.id)
    },
    [definition.id]
  )

  return React.useMemo(
    () => ({
      open: openPanel,
      blocker,
      element: (
        <>
          <AgentsWorkflowGenerateDialog
            open={open}
            onOpenChange={onOpenChange}
            definition={definition}
            generating={generationRun.generating}
            onGenerate={generationRun.start}
          />
          <AgentsWorkflowReplaceGraphDialog
            draft={pendingDraft}
            onCancel={() => setPendingDraft(null)}
            onReplace={(draft) => {
              setPendingDraft(null)
              applyGeneratedGraph(draft)
            }}
          />
        </>
      )
    }),
    [
      applyGeneratedGraph,
      blocker,
      definition,
      generationRun,
      onOpenChange,
      open,
      openPanel,
      pendingDraft
    ]
  )
}
