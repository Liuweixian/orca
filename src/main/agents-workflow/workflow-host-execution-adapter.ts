// Wires this host's real channel runners into one adapter.
//
// A workflow run and a one-off design turn (generation) must pick their channel the same way, so
// both take the adapter built here instead of each assembling its own runners.

import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  createAgentsWorkflowExecutionAdapter,
  type AgentsWorkflowExecutionAdapter
} from './workflow-agent-execution-adapter'
import { createWorkflowFileHandoffTurnRunner } from './workflow-file-handoff-runner'
import { createWorkflowReportTurnRunner } from './workflow-report-turn-runner'
import { createWorkflowStructuredTurnRunner } from './workflow-structured-turn-runner'
import { createWorkflowTranscriptTurnRunner } from './workflow-transcript-turn-runner'

export function createAgentsWorkflowHostExecutionAdapter(
  runtime: OrcaRuntimeService
): AgentsWorkflowExecutionAdapter {
  return createAgentsWorkflowExecutionAdapter(
    createWorkflowStructuredTurnRunner(runtime),
    createWorkflowFileHandoffTurnRunner(runtime),
    createWorkflowTranscriptTurnRunner(runtime),
    createWorkflowReportTurnRunner(runtime)
  )
}
