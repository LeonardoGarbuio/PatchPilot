import type { PlanStep, RunEvent, FileChange } from '@patchpilot/shared'
import type { Sandbox } from '@patchpilot/sandbox'
import { OllamaProvider } from './providers/ollama.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { listDir, readFile, searchFiles, applyPatch, analyzeImpact } from '@patchpilot/tools'
import { join } from 'path'

export interface AgentProvider {
  chat(messages: Message[]): Promise<string>
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type AgentOptions = {
  provider: 'ollama' | 'openai' | 'anthropic'
  model: string
}

type ExecuteOptions = {
  task: string
  plan: PlanStep[]
  sandbox: Sandbox
  projectMemory?: string[]
  onEvent: (event: Omit<RunEvent, 'id' | 'jobId' | 'timestamp'>) => Promise<RunEvent>
}

type PlanOptions = {
  task: string
  repoPath: string
}

const SYSTEM_PROMPT = `You are PatchPilot, a precise and safe AI coding agent.

Your job is to make minimal, targeted changes to a codebase to accomplish a task.

Rules you MUST follow:
1. NEVER modify .env files, secrets, or credential files.
2. NEVER delete files unless explicitly required by the task.
3. NEVER add dependencies without explicit user approval.
4. Make the smallest possible change that correctly solves the task.
5. Always add tests for your changes when a test suite exists.
6. For bug fixes, ALWAYS write a failing test first, run the test to verify it fails, then write the fix, then run the test to verify it passes. This is strict TDD.
7. After making changes, explain exactly what you changed and why.

When you need to take an action, respond with a JSON object like:
{"action": "read_file", "path": "src/auth.ts"}
{"action": "list_dir", "path": "src/"}
{"action": "search", "query": "authentication", "extensions": [".ts"]}
{"action": "analyze_impact", "path": "src/auth.ts", "symbol": "login"}
{"action": "write_file", "path": "src/auth.ts", "content": "...full file content..."}
{"action": "run_command", "command": "npm test"}
{"action": "done", "summary": "...explanation of changes..."}

When you're done, use the "done" action with a clear summary.`

export function createAgent(options: AgentOptions) {
  const provider: AgentProvider =
    options.provider === 'ollama'
      ? new OllamaProvider(options.model)
      : options.provider === 'anthropic'
        ? new AnthropicProvider(options.model)
        : new OpenAIProvider(options.model)

  return {
    async plan({ task, repoPath }: PlanOptions): Promise<PlanStep[]> {
      let structureText = 'Repository structure not available yet.'
      try {
        if (repoPath) {
          const structure = listDir(repoPath, repoPath, 2)
          structureText = structure.map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.path}`).join('\n')
        }
      } catch (err) {
        console.warn(`Could not read repoPath for planning: ${repoPath}`, err)
      }

      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Repository structure:\n${structureText}\n\nTask: ${task}\n\nGenerate a numbered plan of 3-6 concrete steps to accomplish this task. For each step specify:\n- what you will do\n- whether it requires READ, WRITE, or VERIFY permission\n\nRespond with a JSON array of steps: [{"index": 1, "title": "...", "description": "...", "permission": "read|write|verify"}]`,
        },
      ]

      const response = await provider.chat(messages)

      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/)
        if (!jsonMatch) throw new Error('No JSON array found in response')
        return JSON.parse(jsonMatch[0]) as PlanStep[]
      } catch {
        // Fallback: generate a generic plan
        return [
          { index: 1, title: 'Analyze repository structure', description: 'Read relevant files to understand the codebase', permission: 'read' },
          { index: 2, title: 'Implement changes', description: task, permission: 'write' },
          { index: 3, title: 'Verify changes', description: 'Run lint, typecheck, and tests', permission: 'verify' },
        ]
      }
    },

    async execute({ task, plan, sandbox, projectMemory, onEvent }: ExecuteOptions): Promise<FileChange[]> {
      const memoryContext = projectMemory?.length 
        ? `\n\nPast insights for this repository:\n${projectMemory.join('\n')}`
        : ''

      const messages: Message[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Task: ${task}\n\nApproved plan:\n${plan.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}${memoryContext}\n\nWorkspace is at /workspace. Start by exploring the repository structure.`,
        },
      ]

      const writtenFiles = new Map<string, { original: string; current: string }>()
      let done = false
      let iterations = 0
      const MAX_ITERATIONS = 20

      while (!done && iterations < MAX_ITERATIONS) {
        iterations++
        const response = await provider.chat(messages)
        messages.push({ role: 'assistant', content: response })

        let action: any
        try {
          const match = response.match(/\{[\s\S]*?\}(?=\s*$|\s*\n)/m) || response.match(/\{[\s\S]*\}/)
          if (!match) { messages.push({ role: 'user', content: 'Please respond with a valid JSON action object.' }); continue }
          action = JSON.parse(match[0])
        } catch {
          messages.push({ role: 'user', content: 'Invalid JSON. Please respond with a valid JSON action object.' })
          continue
        }

        switch (action.action) {
          case 'read_file': {
            const absPath = join(sandbox.workspacePath, action.path)
            const result = readFile(absPath, sandbox.workspacePath)
            await onEvent({ type: 'file_read', title: `Read ${action.path}`, detail: `${result.lines} lines` })
            messages.push({ role: 'user', content: `File content of ${action.path}:\n\`\`\`\n${result.content}\n\`\`\`` })
            break
          }

          case 'list_dir': {
            const absPath = join(sandbox.workspacePath, action.path ?? '')
            const entries = listDir(absPath, sandbox.workspacePath)
            await onEvent({ type: 'info', title: `Listed ${action.path ?? '/'}`, detail: `${entries.length} entries` })
            messages.push({ role: 'user', content: `Directory listing:\n${entries.map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.path}`).join('\n')}` })
            break
          }

          case 'search': {
            const results = searchFiles(sandbox.workspacePath, action.query, { extensions: action.extensions })
            await onEvent({ type: 'info', title: `Searched for "${action.query}"`, detail: `${results.length} matches` })
            messages.push({ role: 'user', content: `Search results:\n${results.map((r) => `${r.file}:${r.line}  ${r.content}`).join('\n')}` })
            break
          }

          case 'analyze_impact': {
            const results = analyzeImpact(sandbox.workspacePath, action.path, action.symbol)
            await onEvent({ type: 'info', title: `Analyzed impact of ${action.symbol ?? action.path}`, detail: `${results.length} matches` })
            messages.push({ role: 'user', content: `Impact analysis results:\n${results.map((r) => `${r.file}:${r.line}  ${r.content}`).join('\n')}` })
            break
          }

          case 'write_file': {
            const absPath = join(sandbox.workspacePath, action.path)
            let original = ''
            try { original = readFile(absPath, sandbox.workspacePath).content } catch {}

            if (!writtenFiles.has(action.path)) {
              writtenFiles.set(action.path, { original, current: action.content })
            } else {
              writtenFiles.get(action.path)!.current = action.content
            }

            applyPatch(absPath, sandbox.workspacePath, action.content)
            await onEvent({ type: 'file_write', title: `Wrote ${action.path}` })
            messages.push({ role: 'user', content: `✓ File written: ${action.path}` })
            break
          }

          case 'run_command': {
            await onEvent({ type: 'command', title: `Running command: ${action.command}` })
            const { stdout, stderr, exitCode } = await sandbox.exec(action.command)
            const output = `Exit code: ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
            await onEvent({ type: 'info', title: `Command finished (exit ${exitCode})`, detail: action.command })
            messages.push({ role: 'user', content: `Command output:\n\`\`\`\n${output}\n\`\`\`` })
            break
          }

          case 'done': {
            done = true
            await onEvent({ type: 'complete', title: 'Agent done', detail: action.summary })
            break
          }

          default:
            messages.push({ role: 'user', content: `Unknown action "${action.action}". Use: read_file, list_dir, search, write_file, done.` })
        }
      }

      if (!done) await onEvent({ type: 'error', title: 'Max iterations reached', detail: 'The agent did not complete in 20 steps.' })

      // Build FileChange list from written files
      const { createUnifiedDiff } = await import('@patchpilot/git')
      const changes: FileChange[] = []

      for (const [path, { original, current }] of writtenFiles) {
        const diff = createUnifiedDiff(path, original, current)
        const additions = (diff.match(/^\+[^+]/gm) ?? []).length
        const deletions = (diff.match(/^-[^-]/gm) ?? []).length
        changes.push({
          id: '',
          jobId: '',
          path,
          status: original === '' ? 'new' : 'modified',
          diff,
          additions,
          deletions,
        })
      }

      return changes
    },

    async extractMemory(task: string, changes: FileChange[]): Promise<string | null> {
      const messages: Message[] = [
        { role: 'system', content: 'You are an AI that extracts architectural insights or gotchas from a completed coding task.' },
        {
          role: 'user',
          content: `Task: ${task}\n\nChanges:\n${changes.map(c => c.diff).join('\n')}\n\nIf you learned something important about this project's architecture, patterns, or a tricky gotcha, describe it in one concise sentence. If not, reply with "NONE".`,
        },
      ]
      const response = await provider.chat(messages)
      if (response.trim() === 'NONE' || response.trim() === '') return null
      return response.trim()
    },
  }
}
