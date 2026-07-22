import { simpleGit } from 'simple-git'
import { createTwoFilesPatch } from 'diff'
import { readFileSync, existsSync } from 'fs'
import { join, relative } from 'path'

// ─── Unified diff ─────────────────────────────────────────────────────────────

/**
 * Generate a unified diff string between two file contents.
 * Used by the agent to record exactly what changed.
 */
export function createUnifiedDiff(
  filePath: string,
  originalContent: string,
  newContent: string,
): string {
  // Prevent catastrophic O(N^2) hangs in the diff package on large or highly complex files
  if (originalContent.length > 50000 || newContent.length > 50000) {
    return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1,1 +1,1 @@\n-[File too large or complex for inline diff]\n+[File too large or complex for inline diff]`
  }

  return createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    originalContent,
    newContent,
    '',
    '',
    { context: 3 },
  )
}

// ─── Git operations ───────────────────────────────────────────────────────────

export async function cloneRepo(url: string, targetPath: string): Promise<void> {
  const git = simpleGit()
  await git.clone(url, targetPath, ['--depth', '1'])
}

export async function getRepoInfo(repoPath: string): Promise<{
  branch: string
  lastCommit: string
  remoteUrl: string | null
}> {
  const git = simpleGit(repoPath)
  const [branch, log, remotes] = await Promise.all([
    git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
    git.log(['-1']).catch(() => null),
    git.getRemotes(true).catch(() => []),
  ])

  return {
    branch,
    lastCommit: log?.latest?.hash?.slice(0, 8) ?? 'unknown',
    remoteUrl: remotes[0]?.refs?.fetch ?? null,
  }
}

/**
 * Generate a full .patch file for all changes in the workspace compared to the original.
 */
export async function generatePatchFile(
  originalPath: string,
  modifiedPath: string,
  changedFiles: string[],
): Promise<string> {
  const patches: string[] = []

  for (const relPath of changedFiles) {
    const origFile = join(originalPath, relPath)
    const newFile = join(modifiedPath, relPath)

    const original = existsSync(origFile) ? readFileSync(origFile, 'utf-8') : ''
    const modified = existsSync(newFile) ? readFileSync(newFile, 'utf-8') : ''

    patches.push(createUnifiedDiff(relPath, original, modified))
  }

  return patches.join('\n')
}

/**
 * Copy a repository to a new workspace directory for isolated editing.
 */
export async function copyRepo(sourcePath: string, targetPath: string): Promise<void> {
  const { cp } = await import('fs/promises')
  await cp(sourcePath, targetPath, { recursive: true, filter: (src) => !src.includes('node_modules') })
}

export * from './github.js'
