import { spawn } from "node:child_process"
import { open } from "node:fs/promises"
import { performance } from "node:perf_hooks"

export interface ProcessResult { exitStatus: number | null; timedOut: boolean; durationMs: number; error: string | null }
/** Kill the process tree on timeout, including the private OpenCode server (POSIX). */
export async function execute(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number, stdout: string, stderr: string): Promise<ProcessResult> {
  const out = await open(stdout, "w", 0o600)
  const err = await open(stderr, "w", 0o600)
  const started = performance.now()
  try {
    return await new Promise(resolve => {
      const childEnv: NodeJS.ProcessEnv = { ...env, PWD: cwd }
      // Nested fixture tests must emit their requested reporter, not inherit the
      // parent Node test worker's private binary transport.
      delete childEnv.NODE_TEST_CONTEXT
      const child = spawn(argv[0]!, argv.slice(1), { cwd, env: childEnv, detached: process.platform !== "win32", stdio: ["ignore", out.fd, err.fd] })
      let timedOut = false
      let error: string | null = null
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const kill = (signal: NodeJS.Signals) => {
        try { process.kill(-child.pid!, signal) } catch { child.kill(signal) }
      }
      const timer = setTimeout(() => {
        timedOut = true
        kill("SIGTERM")
        killTimer = setTimeout(() => kill("SIGKILL"), 1000)
      }, timeoutMs)
      child.on("error", e => { error = e.message })
      child.on("close", code => {
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        // A CLI can exit leaving a private child alive. Never allow it to mutate the next run.
        if (process.platform !== "win32") kill("SIGKILL")
        resolve({ exitStatus: code, timedOut, durationMs: Math.round(performance.now() - started), error })
      })
    })
  } finally { await out.close(); await err.close() }
}
