// The one machine-readable answer a condition's agent may give.
//
// The runtime parses this JSON, so a judging prompt that never asks for it can only end in a failed
// run; the graph validation rejects such a prompt before it is saved. Matching is tolerant of
// whitespace so authors may write `{ "decision": "yes" }` by hand.

import { z } from 'zod'

export const AGENTS_WORKFLOW_DECISION_YES = '{"decision":"yes"}'
export const AGENTS_WORKFLOW_DECISION_NO = '{"decision":"no"}'

const DECISION_CONTRACT = /\{\s*"decision"\s*:\s*"(yes|no)"\s*\}/gi

/** True when the prompt asks for both decisions the runtime can parse. */
export function agentsWorkflowPromptDeclaresDecision(source: string): boolean {
  const answers = new Set<string>()
  for (const match of source.matchAll(DECISION_CONTRACT)) {
    answers.add((match[1] ?? '').toLowerCase())
  }
  return answers.has('yes') && answers.has('no')
}

export type AgentsWorkflowDecision = 'yes' | 'no'

const DecisionAnswerSchema = z.object({ decision: z.string() })

/** Parses the JSON answer a judge agent must produce; null when it is not one. */
export function parseAgentsWorkflowDecision(source: string): AgentsWorkflowDecision | null {
  let raw: unknown
  try {
    raw = JSON.parse(source.trim())
  } catch {
    return null
  }
  const parsed = DecisionAnswerSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  const normalized = parsed.data.decision.trim().toLowerCase()
  return normalized === 'yes' || normalized === 'no' ? normalized : null
}
