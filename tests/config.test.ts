import test from "node:test"
import assert from "node:assert/strict"
import { resolveConfig } from "../src/core/config.ts"

test("uses safe defaults", () => {
  const config = resolveConfig({})
  assert.equal(config.delegation.maxDepth, 3)
  assert.equal(config.shell.maxTimeoutMs, 120_000)
})

test("rejects invalid depth rather than silently accepting it", () => {
  assert.throws(() => resolveConfig({ delegation: { maxDepth: 0 } }), /maxDepth/)
})

test("rejects duplicate documentation rule ids", () => {
  assert.throws(
    () => resolveConfig({ documentation: { rules: [
      { id: "api", code: ["src/**"], docs: ["docs/**"] },
      { id: "api", code: ["lib/**"], docs: ["docs/**"] },
    ] } }),
    /unique/,
  )
})
