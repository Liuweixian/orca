import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureAgentsWorkflowRunDirectory } from './workflow-run-scratch'

const workspaces: string[] = []

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-scratch-'))
  workspaces.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ensureAgentsWorkflowRunDirectory', () => {
  it('creates the run folder and makes git ignore everything in it', async () => {
    const dir = await workspace()

    const runDirectory = await ensureAgentsWorkflowRunDirectory(dir, 'run-1')

    expect(runDirectory).toBe(join(dir, '.orca-workflow', 'run-1'))
    expect(await readFile(join(runDirectory, '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('never overwrites a .gitignore that is already there', async () => {
    const dir = await workspace()
    const runDirectory = await ensureAgentsWorkflowRunDirectory(dir, 'run-1')
    await writeFile(join(runDirectory, '.gitignore'), '!keep.md\n')

    await ensureAgentsWorkflowRunDirectory(dir, 'run-1')

    expect(await readFile(join(runDirectory, '.gitignore'), 'utf8')).toBe('!keep.md\n')
  })

  it('is idempotent for the folder itself', async () => {
    const dir = await workspace()
    await ensureAgentsWorkflowRunDirectory(dir, 'run-1')
    await ensureAgentsWorkflowRunDirectory(dir, 'run-1')

    expect(existsSync(join(dir, '.orca-workflow', 'run-1'))).toBe(true)
  })
})
