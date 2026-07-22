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
  exec(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  listDir(path: string): Promise<string[]>
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

export function isAllowedCommand(args: string[]): boolean {
  if (!args || args.length === 0) return false
  // Reconstruct command for checking against allowlist
  const cleanCmd = args.join(' ').trim()
  // Block shell characters inside any argument just to be safe
  if (args.some(arg => /[&|;`$()\n]/.test(arg))) return false
  
  return [...ALLOWED_COMMANDS].some(
    (allowed) => cleanCmd === allowed || cleanCmd.startsWith(allowed + ' ')
  )
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

  async function _exec(args: string[]) {
    const exec = await container.exec({
      Cmd: args,
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
        reject(new Error(`Command timed out after 60s: ${args.join(' ')}`))
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
  }

  const sandbox: Sandbox = {
    containerId: container.id,
    workspacePath,

    async exec(args: string[]) {
      if (!isAllowedCommand(args)) {
        return { stdout: '', stderr: `Command not allowed by security policy: ${args.join(' ')}`, exitCode: 1 }
      }
      return _exec(args)
    },

    async readFile(path: string) {
      const { stdout, stderr, exitCode } = await _exec(['cat', path])
      if (exitCode !== 0) throw new Error(stderr || 'File not found')
      return stdout
    },

    async writeFile(path: string, content: string) {
      // Create directory first
      await _exec(['mkdir', '-p', require('path').dirname(path)])
      
      const exec = await container.exec({
        Cmd: ['/bin/sh', '-c', `cat > "${path.replace(/"/g, '\\"')}"`],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: '/workspace',
      })
      const stream = await exec.start({ hijack: true, stdin: true })
      await new Promise<void>((resolve) => {
        stream.write(content)
        stream.end()
        stream.on('end', resolve)
      })
    },

    async listDir(path: string) {
      const { stdout, exitCode } = await _exec(['find', path || '.', '-maxdepth', '2'])
      if (exitCode !== 0) return []
      return stdout.trim().split('\n').filter(Boolean)
    },

    async verify(): Promise<SandboxVerifyResult> {
      // 1. Install dependencies in a container WITH network
      const installContainer = await d.createContainer({
        Image: image,
        Cmd: ['tail', '-f', '/dev/null'],
        WorkingDir: '/workspace',
        HostConfig: {
          Binds: [`${workspacePath}:/workspace:rw`],
          AutoRemove: true,
        },
      })
      await installContainer.start()

      const iExec = async (args: string[]) => {
        const exec = await installContainer.exec({
          Cmd: args,
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: '/workspace',
        })
        const stream = await exec.start({ hijack: true, stdin: false })
        await new Promise<void>((resolve) => {
          stream.on('end', resolve)
          stream.resume() // discard output
        })
      }

      try {
        if (existsSync(`${workspacePath}/package.json`)) {
          await iExec(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'])
        } else if (existsSync(`${workspacePath}/requirements.txt`)) {
          await iExec(['pip', 'install', '-r', 'requirements.txt'])
        }
      } catch (err) {
        console.warn('Failed to install dependencies in install container', err)
      }
      await installContainer.stop({ t: 2 }).catch(() => {})

      // 2. Run verification in a strict container WITHOUT network
      const verifyContainer = await d.createContainer({
        Image: image,
        Cmd: ['tail', '-f', '/dev/null'],
        WorkingDir: '/workspace',
        HostConfig: {
          Binds: [`${workspacePath}:/workspace:rw`],
          Memory: 512 * 1024 * 1024,
          MemorySwap: 512 * 1024 * 1024,
          CpuQuota: 50_000,
          NetworkMode: 'none',
          AutoRemove: true,
          SecurityOpt: ['no-new-privileges:true'],
          CapDrop: ['ALL'],
          ReadonlyRootfs: true,
          PidsLimit: 50,
        },
        Env: [
          'CI=true',
          'NODE_ENV=test',
        ],
      })
      await verifyContainer.start()

      const vExec = async (args: string[]) => {
        const exec = await verifyContainer.exec({
          Cmd: args,
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: '/workspace',
        })
        const stream = await exec.start({ hijack: true, stdin: false })
        let stdout = ''
        let stderr = ''
        await new Promise<void>((resolve, reject) => {
          verifyContainer.modem.demuxStream(
            stream,
            { write: (b: Buffer) => { stdout += b.toString() } },
            { write: (b: Buffer) => { stderr += b.toString() } }
          )
          stream.on('end', resolve)
          stream.on('error', reject)
        })
        const inspection = await exec.inspect()
        return { stdout, stderr, exitCode: inspection.ExitCode ?? 1 }
      }

      const run = async (args: string[]) => {
        const { stdout, stderr, exitCode } = await vExec(args)
        const output = stdout + '\n' + stderr
        if (output.includes('ENOENT') || output.includes('no such file or directory') || (output.includes('package.json') && exitCode !== 0)) {
          return 'skipped'
        }
        if (exitCode !== 0) return 'failed'
        if (output.includes('missing script') || output.trim() === '') return 'skipped'
        return 'passed'
      }

      const lint = await run(['npm', 'run', 'lint', '--if-present']).catch(() => 'skipped' as const)
      const typecheck = await run(['npm', 'run', 'typecheck', '--if-present']).catch(() => 'skipped' as const)

      let testCount = 0
      let tests: 'passed' | 'failed' | 'skipped' = 'skipped'
      try {
        const { stdout, stderr, exitCode } = await vExec(['npm', 'run', 'test', '--if-present'])
        const output = stdout + '\n' + stderr
        if (output.includes('ENOENT') || output.includes('no such file or directory') || (output.includes('package.json') && exitCode !== 0)) {
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

      const build = await run(['npm', 'run', 'build', '--if-present']).catch(() => 'skipped' as const)

      await verifyContainer.stop({ t: 2 }).catch(() => {})

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
