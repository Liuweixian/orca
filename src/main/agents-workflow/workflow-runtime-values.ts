// The values a workflow keeps while it runs.
//
// Every answer a node produces lives on disk as markdown and is named in the next prompt; the
// in-memory maps exist only so the scheduler can tell whether a predecessor produced a value and
// to hand a loop's aggregate to the node after its `done` edge.

import type { AgentsWorkflowNode } from '../../shared/agents-workflow-types'

export type AgentsWorkflowRuntimeValues = {
  nodeOutputs: Map<string, string>
  loopOutputs: Map<string, string>
}

/** How many times this loop runs its body; the schema already bounds it to 1..20. */
export function agentsWorkflowLoopCount(
  node: Extract<AgentsWorkflowNode, { kind: 'loop' }>
): number {
  // Why clamp: a definition loaded from an older state file never went through the schema, and one
  // bad count would wedge the run.
  return Math.min(20, Math.max(1, Math.trunc(node.count)))
}
