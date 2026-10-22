// The one machine-readable answer a condition's agent may give.
//
// The runtime parses this JSON, so a judging prompt that never asks for it can only end in a failed
// run; the graph validation rejects such a prompt before it is saved. Matching is tolerant of
// whitespace so authors may write `{ "decision": "yes" }` by hand.

import { z } from 'zod'

export const AGENTS_WORKFLOW_DECISION_YES = '{"decision":"yes"}'
export const AGENTS_WORKFLOW_DECISION_NO = '{"decision":"no"}'

const DECISION_CONTRACT = /\{\s*"decision"\s*:\s*"(yes|no)"\s*\}/gi

/**
 * True when the prompt asks for both decisions the runtime can parse.
 *
 * Why not require the literal JSON alone: authors legitimately describe the contract in prose
 * ("answer decision yes or no"), and the runtime only needs the agent to emit one of the two
 * tokens. Both decisions must still be named, so the agent cannot guess a branch the author never
 * offered.
 */
export function agentsWorkflowPromptDeclaresDecision(source: string): boolean {
  const answers = new Set<string>()
  for (const match of source.matchAll(DECISION_CONTRACT)) {
    answers.add((match[1] ?? '').toLowerCase())
  }
  if (answers.has('yes') && answers.has('no')) {
    return true
  }
  return /\bdecision\b/i.test(source) && /\byes\b/i.test(source) && /\bno\b/i.test(source)
}

export type AgentsWorkflowDecision = 'yes' | 'no'

const DecisionAnswerSchema = z.object({ decision: z.string() })

/**
 * The places a judge's JSON answer may be hiding: the whole reply, a fenced block, or the first
 * brace span after a sentence of prose. Agents commonly wrap the contract in ```json fences even
 * when told not to, and failing the whole run over the wrapper is not a judgement of the branch.
 */
function* decisionCandidates(source: string): Generator<string> {
  const trimmed = source.trim()
  yield trimmed
  for (const match of trimmed.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)) {
    yield (match[1] ?? '').trim()
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start !== -1 && end > start && !(start === 0 && end === trimmed.length - 1)) {
    yield trimmed.slice(start, end + 1)
  }
}

/** Parses the JSON answer a judge agent must produce; null when it is not one. */
export function parseAgentsWorkflowDecision(source: string): AgentsWorkflowDecision | null {
  for (const candidate of decisionCandidates(source)) {
    let raw: unknown
    try {
      raw = JSON.parse(candidate)
    } catch {
      continue
    }
    const parsed = DecisionAnswerSchema.safeParse(raw)
    if (!parsed.success) {
      continue
    }
    const normalized = parsed.data.decision.trim().toLowerCase()
    if (normalized === 'yes' || normalized === 'no') {
      return normalized
    }
  }
  return null
}
