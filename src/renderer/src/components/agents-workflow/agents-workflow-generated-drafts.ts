// A design that finished while its workflow was not on screen.
//
// The host keeps generating after the page goes away (switching to the agent's chat is exactly what
// a user does), so the answer has to wait somewhere instead of being dropped with the component.

import type { AgentsWorkflowGenerationDraft } from '../../../../shared/agents-workflow-generation'

const draftsByWorkflowId = new Map<string, AgentsWorkflowGenerationDraft>()

// Why module scope: watching the design means switching to the agent's chat, which unmounts the
// page; a per-component flag would let a remounted page start a second design for the same workflow.
const generatingWorkflowIds = new Set<string>()
const generatingListeners = new Set<() => void>()

function notifyGeneratingChange(): void {
  for (const listener of generatingListeners) {
    listener()
  }
}

/** Claims the one design turn a workflow may have in flight. */
export function beginAgentsWorkflowGeneration(workflowId: string): void {
  if (generatingWorkflowIds.has(workflowId)) {
    return
  }
  generatingWorkflowIds.add(workflowId)
  notifyGeneratingChange()
}

export function endAgentsWorkflowGeneration(workflowId: string): void {
  if (!generatingWorkflowIds.delete(workflowId)) {
    return
  }
  notifyGeneratingChange()
}

export function isAgentsWorkflowGenerating(workflowId: string): boolean {
  return generatingWorkflowIds.has(workflowId)
}

export function subscribeAgentsWorkflowGeneration(listener: () => void): () => void {
  generatingListeners.add(listener)
  return () => {
    generatingListeners.delete(listener)
  }
}

/** Holds a finished design until the surface for that workflow is on screen again. */
export function holdAgentsWorkflowGeneratedDraft(
  workflowId: string,
  draft: AgentsWorkflowGenerationDraft
): void {
  draftsByWorkflowId.set(workflowId, draft)
}

/** Takes the held design, if any; a second call for the same workflow returns null. */
export function takeAgentsWorkflowGeneratedDraft(
  workflowId: string
): AgentsWorkflowGenerationDraft | null {
  const draft = draftsByWorkflowId.get(workflowId)
  if (draft === undefined) {
    return null
  }
  draftsByWorkflowId.delete(workflowId)
  return draft
}
