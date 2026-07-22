import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, relative, extname } from 'path'

// ─── Security: blocked file patterns ─────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /secrets?\./i,
  /credentials?\./i,
  /id_rsa/i,
  /\.ssh\//i,
  /\.aws\//i,
]

const MAX_FILE_SIZE_BYTES = 500 * 1024 // 500 KB per file

function isBlocked(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(normalized))
}

// ─── File Reader ──────────────────────────────────────────────────────────────

export interface ReadResult {
  path: string
  content: string
  lines: number
  blocked: boolean
}

export function readFile(absolutePath: string, repoRoot: string): ReadResult {
  const relPath = relative(repoRoot, absolutePath)

  if (relPath.startsWith('..') || isBlocked(relPath)) {
    return { path: relPath, content: '[REDACTED — sensitive or out of bounds]', lines: 0, blocked: true }
  }

  const stat = statSync(absolutePath)
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return {
      path: relPath,
      content: `[File too large: ${Math.round(stat.size / 1024)} KB, max 500 KB]`,
      lines: 0,
      blocked: false,
    }
  }

  const content = readFileSync(absolutePath, 'utf-8')
  return { path: relPath, content, lines: content.split('\n').length, blocked: false }
}

// ─── Directory Lister ─────────────────────────────────────────────────────────

export interface DirEntry {
  path: string
  type: 'file' | 'dir'
  size?: number
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.turbo'])

export function listDir(absolutePath: string, repoRoot: string, maxDepth = 3): DirEntry[] {
  const entries: DirEntry[] = []

  const startRel = relative(repoRoot, absolutePath)
  if (startRel.startsWith('..') && absolutePath !== repoRoot) {
    return [] // Out of bounds
  }

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') && depth > 0) continue
      if (IGNORED_DIRS.has(name)) continue

      const full = join(dir, name)
      const rel = relative(repoRoot, full)
      const stat = statSync(full)

      if (stat.isDirectory()) {
        entries.push({ path: rel, type: 'dir' })
        walk(full, depth + 1)
      } else {
        entries.push({ path: rel, type: 'file', size: stat.size })
      }
    }
  }

  walk(absolutePath, 0)
  return entries
}

// ─── File Searcher ────────────────────────────────────────────────────────────

export interface SearchMatch {
  file: string
  line: number
  content: string
}

export function searchFiles(
  repoRoot: string,
  query: string,
  options?: { extensions?: string[]; maxResults?: number },
): SearchMatch[] {
  const matches: SearchMatch[] = []
  const maxResults = options?.maxResults ?? 50
  const extensions = options?.extensions ?? ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java']

  function walk(dir: string) {
    if (matches.length >= maxResults) return
    for (const name of readdirSync(dir)) {
      if (IGNORED_DIRS.has(name)) continue
      const full = join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (extensions.includes(extname(name)) && !isBlocked(relative(repoRoot, full))) {
        const content = readFileSync(full, 'utf-8')
        const lines = content.split('\n')
        lines.forEach((line, i) => {
          if (matches.length < maxResults && line.includes(query)) {
            matches.push({ file: relative(repoRoot, full), line: i + 1, content: line.trim() })
          }
        })
      }
    }
  }

  walk(repoRoot)
  return matches
}

// ─── Patch Writer ─────────────────────────────────────────────────────────────

/**
 * Apply a unified diff to a file.
 * NEVER writes outside the repo root.
 */
export function applyPatch(absolutePath: string, repoRoot: string, newContent: string): void {
  // Security: verify the path is inside the repo root
  const rel = relative(repoRoot, absolutePath)
  if (rel.startsWith('..') || isBlocked(rel)) {
    throw new Error(`Patch denied: "${rel}" is outside the repo root or is a sensitive file`)
  }

  writeFileSync(absolutePath, newContent, 'utf-8')
}

// ─── Impact Analyzer ──────────────────────────────────────────────────────────

export interface ImpactMatch {
  file: string
  line: number
  content: string
}

export function analyzeImpact(repoRoot: string, filePath: string, symbol?: string): ImpactMatch[] {
  // Simple heuristic: search for the symbol across the codebase, 
  // or search for imports of the filePath's basename.
  const searchFor = symbol ?? (filePath.split('/').pop()?.replace(/\.[^/.]+$/, '') ?? '')
  if (!searchFor) return []
  
  return searchFiles(repoRoot, searchFor, { maxResults: 100 })
}
