import test from "node:test"
import assert from "node:assert/strict"
import {
  ENGRAM_STATUS_KEY,
  detectEngramIntegration,
  inspectOpenCodeEngramConfig,
  openCodeConfigCandidates,
  setupEngramIntegration,
} from "../src/integrations/engram/index.ts"

function memoryState() {
  const data = new Map<string, unknown>()
  return {
    async get<T>(key: string) { return data.get(key) as T | undefined },
    async set<T>(key: string, value: T) { data.set(key, value) },
    async remove(key: string) { data.delete(key) },
    async scan<T>(prefix: string) {
      return [...data.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: value as T }))
    },
  }
}

test("OpenCode Engram config discovery accepts JSONC and the agent profile", () => {
  const direct = inspectOpenCodeEngramConfig(`{
    // user config
    "mcp": {
      "engram": {
        "type": "local",
        "command": ["/usr/local/bin/engram", "mcp", "--tools=agent"],
        "enabled": true,
      },
    },
  }`)
  assert.deepEqual(direct, { configured: true, enabled: true, agentProfile: true })

  const nested = inspectOpenCodeEngramConfig(`{"mcp":{"servers":{"engram":{"command":["engram","mcp","--tools=agent"],"disabled":true}}}}`)
  assert.deepEqual(nested, { configured: true, enabled: false, agentProfile: true })

  const unrelated = inspectOpenCodeEngramConfig(`{"mcp":{"other":{"command":["engram-helper","mcp"]}}}`)
  assert.equal(unrelated.configured, false)
})

test("Engram detection is non-blocking and reports binary+config readiness", async () => {
  const env = { OPENCODE_CONFIG_DIR: "/tmp/opencode-test" } as Record<string, string | undefined>
  const candidates = openCodeConfigCandidates({ env, homeDir: "/home/test", projectRoot: "/repo" })
  assert.ok(candidates.includes("/home/test/.config/opencode/opencode.jsonc"))
  assert.ok(candidates.includes("/tmp/opencode-test/opencode.jsonc"))
  assert.ok(candidates.includes("/repo/opencode.jsonc"))

  const status = await detectEngramIntegration({
    env,
    homeDir: "/home/test",
    projectRoot: "/repo",
    now: () => 123,
    runVersion: async () => "engram v2.2.1",
    readText: async (path) => {
      if (path === "/tmp/opencode-test/opencode.jsonc") {
        return `{"mcp":{"engram":{"type":"local","command":["engram","mcp","--tools=agent"]}}}`
      }
      throw Object.assign(new Error("missing"), { code: "ENOENT" })
    },
  })

  assert.equal(status.installed, true)
  assert.equal(status.version, "engram v2.2.1")
  assert.equal(status.configured, true)
  assert.equal(status.enabled, true)
  assert.equal(status.agentProfile, true)
  assert.equal(status.available, true)
  assert.equal(status.availabilityBasis, "binary+config")
  assert.equal(status.configSource, "/tmp/opencode-test/opencode.jsonc")
  assert.equal(status.runtimeObserved, false)
})

test("Engram detection follows OpenCode precedence for partial overrides", async () => {
  const status = await detectEngramIntegration({
    env: { OPENCODE_CONFIG: "/custom/opencode.json", OPENCODE_CONFIG_CONTENT: `{"mcp":{"engram":{"enabled":true}}}` },
    homeDir: "/home/test",
    projectRoot: "/repo",
    runVersion: async () => "engram v2.2.1",
    readText: async (path) => {
      if (path === "/home/test/.config/opencode/opencode.json") return `{"mcp":{"engram":{"type":"local","command":["engram","mcp","--tools=agent"],"enabled":true}}}`
      if (path === "/custom/opencode.json") return `{"mcp":{"engram":{"enabled":false}}}`
      if (path === "/repo/opencode.json") return `{"mcp":{"engram":{"environment":{"A":"1"}}}}`
      throw Object.assign(new Error("missing"), { code: "ENOENT" })
    },
  })
  assert.equal(status.configured, true)
  assert.equal(status.enabled, true)
  assert.equal(status.available, true)
  assert.equal(status.agentProfile, true)
  assert.equal(status.configSource, "env:OPENCODE_CONFIG_CONTENT")
})

test("Engram runtime observation records metadata only and upgrades availability evidence", async () => {
  const state: any = memoryState()
  const hooks = new Map<string, (event: any) => Promise<void>>()
  const events: any[] = []
  const ctx: any = {
    location: { directory: "/repo", project: { canonical: "/repo" } },
    tool: {
      async hook(name: string, fn: (event: any) => Promise<void>) {
        hooks.set(name, fn)
        return { dispose() {} }
      },
    },
  }

  // Seed status so this test does not depend on the machine running the suite.
  await state.set(ENGRAM_STATUS_KEY, {
    provider: "engram", mode: "advisory", installed: false, configured: false, enabled: false,
    available: false, availabilityBasis: "unavailable", runtimeObserved: false, checkedAt: 1,
  })

  const originalPath = process.env.PATH
  process.env.PATH = ""
  try {
    await setupEngramIntegration({
      ctx,
      state,
      observability: { emit(event: any) { events.push(event) }, subscribe() { return () => {} } },
    })
  } finally {
    process.env.PATH = originalPath
  }

  // setup refreshed status; invoke the actual hook and verify no query/result content is emitted.
  const after = hooks.get("execute.after")
  assert.ok(after)
  await after!({
    tool: "engram.mem_search",
    status: "completed",
    sessionID: "ses-1",
    input: { query: "secret query text", all_projects: true },
    output: "secret memory content",
  })

  const status = await state.get<any>(ENGRAM_STATUS_KEY)
  assert.equal(status.runtimeObserved, true)
  assert.equal(status.available, true)
  assert.equal(status.availabilityBasis, "observed-tool-call")
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].payload, {
    action: "engram_memory_call",
    operation: "mem_search",
    status: "completed",
    crossProject: true,
  })
  assert.doesNotMatch(JSON.stringify(events[0]), /secret query text|secret memory content/)
})

test("Engram integration fails open when optional hook registration is unavailable", async () => {
  const state: any = memoryState()
  const ctx: any = {
    location: { directory: "/repo" },
    tool: { async hook() { throw new Error("hook unavailable") } },
  }
  const originalPath = process.env.PATH
  process.env.PATH = ""
  try {
    const dispose = await setupEngramIntegration({ ctx, state })
    assert.equal(typeof dispose, "function")
    assert.doesNotThrow(() => dispose())
  } finally {
    process.env.PATH = originalPath
  }
})
