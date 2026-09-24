import test from "node:test"
import assert from "node:assert/strict"
import { runReview } from "../src/core/review-session.ts"

test("runReview maps wait timeout to structured unavailable", async () => {
  const sessions = {
    async prompt() {
      return { parts: [] }
    },
    async wait() {
      const error = new Error("child session timed out during session.wait")
      error.name = "ChildSessionTimeoutError"
      throw error
    },
    async context() {
      return []
    },
  }

  const result = await runReview(sessions, "review-1", "packet", 100)
  assert.equal(result.status, "unavailable")
  if (result.status !== "unavailable") return
  assert.equal(result.reason, "deadline_exceeded")
  assert.equal(result.stage, "session.wait")
})

test("runReview reads one final assistant response from a fresh review session", async () => {
  let waits = 0
  const sessions = {
    async prompt() {
      return { parts: [] }
    },
    async wait() {
      waits += 1
      return undefined
    },
    async context() {
      return [
        {
          type: "assistant",
          content: [{ type: "text", text: '{"verdict":"approve","findings":[]}' }],
        },
      ]
    },
  }

  const result = await runReview(sessions, "review-2", "packet", 1000)
  assert.equal(result.status, "completed")
  if (result.status !== "completed") return
  assert.match(result.text ?? "", /"approve"/)
  assert.equal(waits, 1)
})

test("runReview tolerates one fresh-session idle race without creating a retry session", async () => {
  let reads = 0
  let waits = 0
  const sessions = {
    async prompt() {
      return { parts: [] }
    },
    async wait() {
      waits += 1
      return undefined
    },
    async context() {
      reads += 1
      if (reads === 1) return []
      return [
        {
          type: "assistant",
          content: [{ type: "text", text: '{"verdict":"approve","findings":[]}' }],
        },
      ]
    },
  }

  const result = await runReview(sessions, "review-3", "packet", 1000)
  assert.equal(result.status, "completed")
  if (result.status !== "completed") return
  assert.match(result.text ?? "", /"approve"/)
  assert.equal(waits, 2)
})
