import test from "node:test"
import assert from "node:assert/strict"
import { createSemanticObservability } from "../src/core/observability.ts"

test("semantic observability emits metadata-only envelope with project/session identity", async () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.ANDMAR_OBSERVABILITY_URL
  const originalEnabled = process.env.ANDMAR_OBSERVABILITY_ENABLED
  const calls: Array<{ url: string; init: RequestInit }> = []

  process.env.ANDMAR_OBSERVABILITY_URL = "http://127.0.0.1:4000"
  process.env.ANDMAR_OBSERVABILITY_ENABLED = "1"
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response("{}", { status: 201 })
  }) as typeof fetch

  try {
    const sink = createSemanticObservability({
      directory: "/tmp/project",
      project: { canonical: "/tmp/project" },
    })
    sink.emit({
      type: "andmar.routing",
      sessionID: "ses-1",
      payload: { kind: "feature", profile: "standard" },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.url, "http://127.0.0.1:4000/events")
    const body = JSON.parse(String(calls[0]?.init.body))
    assert.deepEqual(body, {
      source_app: "project",
      session_id: "ses-1",
      event_type: "andmar.routing",
      payload: { kind: "feature", profile: "standard" },
    })
  } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.ANDMAR_OBSERVABILITY_URL
    else process.env.ANDMAR_OBSERVABILITY_URL = originalUrl
    if (originalEnabled === undefined) delete process.env.ANDMAR_OBSERVABILITY_ENABLED
    else process.env.ANDMAR_OBSERVABILITY_ENABLED = originalEnabled
  }
})

test("semantic observability is fail-open and ignores missing session ids", async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error("offline")
  }) as typeof fetch

  try {
    const sink = createSemanticObservability({ directory: "/tmp/project" })
    assert.doesNotThrow(() => {
      sink.emit({ type: "andmar.completion", sessionID: "", payload: { ok: false } })
      sink.emit({ type: "andmar.completion", sessionID: "ses-1", payload: { ok: false } })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
