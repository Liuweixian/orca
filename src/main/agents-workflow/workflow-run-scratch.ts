// The scratch folder a run writes into inside the worktree.
//
// It lives in the user's checkout, so it must never show up as untracked work: the folder gets its
// own `.gitignore` the moment it is created, and nothing inside it may be committed by accident.
// The whole folder is scratch: the run removes it when it ends, and every value it held is already
// in run history.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { agentsWorkflowRunDirectory } from '../../shared/agents-workflow-output-paths'

const GITIGNORE = '.gitignore'
const IGNORE_EVERYTHING = '*\n'

/** Creates the run folder and makes git ignore it; safe to call repeatedly. */
export async function ensureAgentsWorkflowRunDirectory(
  workspacePath: string,
  runId: string
): Promise<string> {
  const directory = agentsWorkflowRunDirectory(workspacePath, runId)
  await mkdir(directory, { recursive: true })
  try {
    // Why not `force: false` alone: a user's own file of that name must not be overwritten.
    await writeFile(join(directory, GITIGNORE), IGNORE_EVERYTHING, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
      throw error
    }
  }
  return directory
}
