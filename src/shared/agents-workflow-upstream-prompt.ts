// What a node's prompt inherits from the step before it.
//
// A workflow reads top to bottom, so a node's prompt names the file the previous answer was saved
// to instead of repeating it inline: one short instruction, and the agent reads the answer itself.
// Conditions are transparent (they produce no text) and a loop's `done` port carries its aggregate.

import { agentsWorkflowUpstreamRelativePath } from './agents-workflow-output-paths'
import type { AgentsWorkflowDefinition } from './agents-workflow-types'

/** Marks an inherited answer so an agent can tell it apart from the instruction that follows. */
export function agentsWorkflowUpstreamMarker(nodeId: string): string {
  return `<!-- orca:upstream:${nodeId} -->`
}

/**
 * A predecessor that produced an answer, found by walking back through nodes that produce no text
 * of their own (start, condition). A loop body does not inherit from before the loop: its iteration
 * values are its context, so the walk stops at the `each` edge.
 */
function findUpstreamNodes(input: {
  definition: AgentsWorkflowDefinition
  nodeId: string
  hasValue: (nodeId: string) => boolean
}): string[] {
  const found: string[] = []
  const visited = new Set<string>([input.nodeId])

  const walk = (nodeId: string): void => {
    for (const edge of input.definition.edges) {
      if (edge.toNodeId !== nodeId || visited.has(edge.fromNodeId)) {
        continue
      }
      const from = input.definition.nodes.find((node) => node.id === edge.fromNodeId)
      if (!from) {
        continue
      }
      visited.add(from.id)
      if (input.hasValue(from.id)) {
        found.push(from.id)
        continue
      }
      // A condition or start hands on nothing of its own, so the answer is further back. A loop's
      // `each` edge is not a hand-off; only its `done` aggregate is.
      if (from.kind === 'condition' || from.kind === 'start') {
        walk(from.id)
      }
    }
  }

  walk(input.nodeId)
  return found
}

/** The inherited part of a node's prompt, or null when nothing precedes it with an answer. */
export function agentsWorkflowUpstreamPrompt(input: {
  definition: AgentsWorkflowDefinition
  nodeId: string
  runId: string
  hasValue: (nodeId: string) => boolean
}): string | null {
  const nodes = findUpstreamNodes({
    definition: input.definition,
    nodeId: input.nodeId,
    hasValue: input.hasValue
  })
  if (nodes.length === 0) {
    return null
  }
  return nodes
    .map(
      (nodeId) =>
        `${agentsWorkflowUpstreamMarker(nodeId)}\nread ${agentsWorkflowUpstreamRelativePath(
          input.runId,
          nodeId
        )} first, then`
    )
    .join('\n\n')
}

/** The prompt a node's agent receives: what to read first, then what the author wrote. */
export function withAgentsWorkflowUpstream(prompt: string, upstream: string | null): string {
  return upstream === null ? prompt : `${upstream}\n\n${prompt}`
}
