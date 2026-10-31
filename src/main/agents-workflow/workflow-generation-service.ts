// Runs one agent turn that turns a user request into a workflow graph.
//
// The generator is an ordinary agent in the workflow's own workspace, so it can read the project
// it is designing a workflow for. It takes the same channel the runs take, so every agent this
// host can run can design a graph. A second turn repairs a graph the validator rejects.

import { randomUUID } from 'node:crypto'
import type { TuiAgent } from '../../shared/tui-agent'
import {
  buildAgentsWorkflowGenerationPrompt,
  parseAgentsWorkflowGenerationDraft,
  type AgentsWorkflowGenerationDraft
} from '../../shared/agents-workflow-generation'
import { agentsWorkflowAgentChannelPlanEntries } from '../../shared/agents-workflow-agent-channels'
import type { AgentsWorkflowValidationIssue } from '../../shared/agents-workflow-graph'
import { startSpan } from '../observability/tracer'
import type { AgentsWorkflowExecutionAdapter } from './workflow-agent-execution-adapter'
import { removeAgentsWorkflowRunScratch } from './workflow-run-lifecycle'

/** One answer, plus one repair turn: a third attempt is a design problem the user should see. */
const MAX_GENERATION_ATTEMPTS = 2

/** A stuck agent must not leave the run's chat open forever; nobody is watching the generation. */
export const AGENTS_WORKFLOW_GENERATION_TIMEOUT_MS = 5 * 60 * 1000

type AgentsWorkflowGenerationResult = {
  draft: AgentsWorkflowGenerationDraft
}

/** Only the turn and its cleanup: a generation never cancels through the adapter's own handle. */
export type AgentsWorkflowGenerationRunner = Pick<
  AgentsWorkflowExecutionAdapter,
  'execute' | 'release'
>

/**
 * Narrows the caller's usable agents to the ones this host has a channel plan for, so the prompt
 * never names an agent the generated graph cannot actually run.
 */
function agentsWorkflowGenerationAgentIds(available: readonly TuiAgent[]): readonly TuiAgent[] {
  const planned = new Set(agentsWorkflowAgentChannelPlanEntries().map((entry) => entry.agent))
  const usable = available.filter((agent) => planned.has(agent))
  if (usable.length === 0) {
    throw new Error('None of the selected agents can run a workflow node on this host.')
  }
  return usable
}

export async function generateAgentsWorkflowDraft(input: {
  runner: AgentsWorkflowGenerationRunner
  workspaceId: string
  /** The worktree on disk; the file channel writes its output contract here. */
  workspacePath: string
  agentId: TuiAgent
  /** Every agent a generated node may name; the dialog supplies what this host can run. */
  agentIds: readonly TuiAgent[]
  request: string
}): Promise<AgentsWorkflowGenerationResult> {
  const runId = `generate-${randomUUID()}`
  const agentIds = agentsWorkflowGenerationAgentIds(input.agentIds)
  const node = {
    id: 'generate',
    title: 'Generate workflow',
    agentId: input.agentId,
    terminal: false
  }
  // Why a controller: the wait has to settle through the runner's own abort path, so the timer
  // aborts the very turn the runner is waiting on.
  const controller = new AbortController()
  // Why a span: a generation that ends without a draft leaves nothing behind, so its refusal code
  // and turn length are the only evidence of what the agent did.
  const span = startSpan('agents-workflow.generation', {
    attributes: { agent: input.agentId, workspace: input.workspaceId }
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  // Why keep the turn on a real failure: the design failed, so what the agent said is the only
  // evidence of why. A cancel or a timeout is the caller's own doing and leaves nothing to read.
  let keepTurnOnScreen = false
  try {
    timer = setTimeout(
      () => controller.abort(new Error('The agent did not finish designing the workflow in time.')),
      AGENTS_WORKFLOW_GENERATION_TIMEOUT_MS
    )
    let prompt = buildAgentsWorkflowGenerationPrompt({
      request: input.request,
      agentIds,
      defaultAgentId: input.agentId
    })
    let lastIssues: AgentsWorkflowValidationIssue[] = []
    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
      span.setAttribute('attempt', attempt)
      const turn = await input.runner.execute({
        runId,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath,
        node,
        prompt,
        signal: controller.signal
      })
      if (!turn.ok) {
        span.setAttribute('outcome', controller.signal.aborted ? 'aborted' : 'refused')
        span.setAttribute('refusalCode', turn.code)
        // Why the abort reason first: a pane channel reports its own abort as "cancelled", which
        // would hide the timeout and the renderer's cancel behind one wrong message.
        if (controller.signal.aborted && controller.signal.reason instanceof Error) {
          throw controller.signal.reason
        }
        keepTurnOnScreen = true
        // Why the code: the refusal alone reads the same for a dead agent and a missing output file.
        throw new Error(`${turn.message} (${turn.code})`)
      }
      // Why the turn's own channel output: a protocol agent answers in its chat, a pane agent in a
      // file; both arrive here as plain text the JSON parser already unwraps.
      const parsed = parseAgentsWorkflowGenerationDraft(turn.output.content, agentIds)
      span.setAttribute('outputChars', turn.output.content.length)
      if (parsed.ok) {
        span.setAttribute('outcome', 'draft')
        span.setAttribute('nodes', parsed.draft.nodes.length)
        return { draft: parsed.draft }
      }
      span.setAttribute('parseIssues', parsed.issues.map((issue) => issue.code).join(','))
      lastIssues = parsed.issues
      prompt = buildAgentsWorkflowGenerationPrompt({
        request: input.request,
        agentIds,
        defaultAgentId: input.agentId,
        repair: { issues: parsed.issues, previous: turn.output.content }
      })
    }
    keepTurnOnScreen = true
    span.setAttribute('outcome', 'invalid')
    throw new Error(
      lastIssues.length > 0
        ? `The agent could not produce a valid workflow: ${lastIssues.map((issue) => issue.message).join('; ')}`
        : 'The agent could not produce a valid workflow.'
    )
  } catch (error) {
    span.setAttribute('error', error instanceof Error ? error.message : String(error))
    span.fail(error instanceof Error ? error : new Error(String(error)))
    throw error
  } finally {
    span.end()
    clearTimeout(timer)
    // Why reclaim unless the design failed: nobody watches a completed generation, but a failed one
    // is exactly when the user needs to read what the agent said or left behind.
    try {
      await input.runner.release?.(runId, { reclaim: !keepTurnOnScreen })
    } catch (error) {
      // A release failure must not mask the generation's result, nor skip the scratch removal.
      console.error('[agents-workflow] Generation release failed:', error)
    }
    // Why the scratch removal: the file channel writes its contract inside the user's checkout, and
    // no run lifecycle owns this runId to clean it up.
    await removeAgentsWorkflowRunScratch(input.workspacePath, runId)
  }
}
