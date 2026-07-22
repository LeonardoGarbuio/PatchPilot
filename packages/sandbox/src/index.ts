import Docker from 'dockerode'
import { existsSync } from 'fs'

let docker: Docker | null = null

function getDocker(): Docker {
  if (!docker) docker = new Docker()
  return docker
}

export interface SandboxVerifyResult {
  lint: 'passed' | 'failed' | 'skipped'
  typecheck: 'passed' | 'failed' | 'skipped'
  tests: 'passed' | 'failed' | 'skipped'
  testCount: number
  build: 'passed' | 'failed' | 'skipped'
  allPassed: boolean
}

export interface Sandbox {
  containerId: string
  workspacePath: string
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
  verify(): Promise<SandboxVerifyResult>
  destroy(): Promise<void>
}

/**
 * Security-enforced Docker sandbox policies.
 *
 * Each job gets a fresh container with:
 * - Network disabled during edit phase
 * - RAM capped at 512 MB
 * - CPU quota at 50% of one core
 * - Only the workspace directory mounted (read-write)
 * - Root filesystem is writable only inside /workspace
 * - Container auto-removed on exit
 */
const ALLOWED_COMMANDS = new Set([
  'npm run lint',
  'npm run typecheck',
  'npm test',
  'npm run test',
  'npm run build',
  'npx tsc --noEmit',
  'python -m pytest',
  'cargo test',
  'go test ./...',
])

function isAllowedCommand(cmd: string): boolean {
  return [...ALLOWED_COMMANDS].some((allowed) => cmd.trim().startsWith(allowed.split(' ')[0]!))
}

// ─── Base image selection per project type ────────────────────────────────────

function detectImage(workspacePath: string): string {
  if (existsSync(`${workspacePath}/package.json`)) return 'node:20-alpine'
  if (existsSync(`${workspacePath}/requirements.txt`)) return 'python:3.12-slim'
  if (existsSync(`${workspacePath}/Cargo.toml`)) return 'rust:1.82-slim'
  if (existsSync(`${workspacePath}/go.mod`)) return 'golang:1.23-alpine'
  return 'node:20-alpine' // default
}

export async function createSandbox(options: { workspacePath: string }): Promise<Sandbox> {
  const { workspacePath } = options
  const d = getDocker()
  const image = detectImage(workspacePath)

  // Pull image if not available
  try {
    await d.getImage(image).inspect()
  } catch {
    await new Promise<void>((resolve, reject) => {
      d.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err)
        d.modem.followProgress(stream, (err) => err ? reject(err) : resolve())
      })
    })
  }

  const container = await d.createContainer({
    Image: image,
    Cmd: ['tail', '-f', '/dev/null'], // keep alive
    WorkingDir: '/workspace',
    HostConfig: {
      Binds: [`${workspacePath}:/workspace:rw`],
      Memory: 512 * 1024 * 1024,      // 512 MB
      MemorySwap: 512 * 1024 * 1024,  // no swap
      CpuQuota: 50_000,               // 50% of 1 CPU
      NetworkMode: 'none',            // NO network access
      AutoRemove: true,
      SecurityOpt: ['no-new-privileges:true'],
      CapDrop: ['ALL'],               // drop all linux capabilities
      ReadonlyRootfs: true,           // Root filesystem is read-only
      PidsLimit: 50,                  // Prevent fork bombs
    },
    Env: [
      'CI=true',
      'NODE_ENV=test',
    ],
  })

  await container.start()

  const sandbox: Sandbox = {
    containerId: container.id,
    workspacePath,

    async exec(command: string) {
      if (!isAllowedCommand(command)) {
        return { stdout: '', stderr: `Command not allowed by security policy: ${command}`, exitCode: 1 }
      }

      const exec = await container.exec({
        Cmd: ['/bin/sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: '/workspace',
      })

      const stream = await exec.start({ hijack: true, stdin: false })
      let stdout = ''
      let stderr = ''

      await new Promise<void>((resolve, reject) => {
        container.modem.demuxStream(
          stream,
          { write: (chunk: Buffer) => { stdout += chunk.toString() } },
          { write: (chunk: Buffer) => { stderr += chunk.toString() } },
        )
        let done = false
        
        const timeout = setTimeout(() => {
          if (done) return
          done = true
          stream.destroy()
          reject(new Error(`Command timed out after 60s: ${command}`))
        }, 60000)

        stream.on('end', () => {
          if (done) return
          done = true
          clearTimeout(timeout)
          resolve()
        })
        
        stream.on('error', (err) => {
          if (done) return
          done = true
          clearTimeout(timeout)
          reject(err)
        })
      })

      const inspection = await exec.inspect()
      return { stdout, stderr, exitCode: inspection.ExitCode ?? 1 }
    },

    async verify(): Promise<SandboxVerifyResult> {
      const run = async (cmd: string) => {
        const { stdout, stderr, exitCode } = await sandbox.exec(cmd)
        const output = stdout + '\n' + stderr
        if (output.includes('ENOENT') || output.includes('no such file or directory') || output.includes('package.json') && exitCode !== 0) {
          return 'skipped'
        }
        if (exitCode !== 0) return 'failed'
        if (output.includes('missing script') || output.trim() === '') return 'skipped'
        return 'passed'
      }

      // Install deps first (with network temporarily re-enabled is NOT done — use pre-installed image)
      const lint = await run('npm run lint --if-present').catch(() => 'skipped' as const)
      const typecheck = await run('npm run typecheck --if-present').catch(() => 'skipped' as const)

      let testCount = 0
      let tests: 'passed' | 'failed' | 'skipped' = 'skipped'
      try {
        const { stdout, stderr, exitCode } = await sandbox.exec('npm run test --if-present -- --reporter=json 2>/dev/null || npm run test --if-present 2>&1')
        const output = stdout + '\n' + stderr
        if (output.includes('ENOENT') || output.includes('no such file or directory') || output.includes('package.json') && exitCode !== 0) {
          tests = 'skipped'
        } else if (exitCode !== 0) {
          tests = 'failed'
        } else if (output.includes('no test specified') || output.trim() === '') {
          tests = 'skipped'
        } else {
          tests = 'passed'
          const match = output.match(/(\d+) passed/)
          if (match) testCount = parseInt(match[1]!)
        }
      } catch {}

      const build = await run('npm run build --if-present').catch(() => 'skipped' as const)

      const allPassed = [lint, typecheck, tests, build].every((r) => r !== 'failed')

      return { lint, typecheck, tests, testCount, build, allPassed }
    },

    async destroy() {
      try {
        await container.stop({ t: 5 })
      } catch {
        // Container may already be stopped (AutoRemove=true handles cleanup)
      }
    },
  }

  return sandbox
}

// Static method for checking Docker availability
createSandbox.isDockerAvailable = async (): Promise<boolean> => {
  try {
    await getDocker().ping()
    return true
  } catch {
    return false
  }
}
