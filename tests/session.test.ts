import test from "node:test"
import assert from "node:assert/strict"
import { runChildTask } from "../src/core/session.ts"

test("runChildTask hard-times-out when session.wait never resolves", async () => {
  const sessions = {
    async prompt() {
      return { queued: true }
    },
    async wait() {
      return new Promise<never>(() => {})
    },
    async context() {
      return []
    },
  }

  const started = Date.now()
  await assert.rejects(
    () => runChildTask(sessions, "child-1", "review", { timeoutMs: 30, retryDelayMs: 5 }),
    /timed out during session\.wait/,
  )
  assert.ok(Date.now() - started < 1000)
})

test("runChildTask hard-times-out when session.context never resolves", async () => {
  const sessions = {
    async prompt() {
      return { queued: true }
    },
    async wait() {
      return undefined
    },
    async context() {
      return new Promise<never>(() => {})
    },
  }

  await assert.rejects(
    () => runChildTask(sessions, "child-1", "review", { timeoutMs: 30, retryDelayMs: 5 }),
    /timed out during session\.context/,
  )
})
