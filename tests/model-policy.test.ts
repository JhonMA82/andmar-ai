import test from "node:test"
import assert from "node:assert/strict"
import { clampRequestedProfile, escalate, minimumProfile } from "../src/core/model-policy.ts"

test("routes a tiny UI change to fast", () => {
  assert.equal(minimumProfile({ kind: "trivial-ui", scopeFiles: 1, risk: "low", uncertainty: "low" }), "fast")
})

test("routes security and architecture to frontier", () => {
  assert.equal(minimumProfile({ kind: "security" }), "frontier")
  assert.equal(minimumProfile({ kind: "architecture" }), "frontier")
})

test("does not allow an explicit request to lower the minimum", () => {
  assert.equal(clampRequestedProfile("fast", "frontier"), "frontier")
  assert.equal(clampRequestedProfile("frontier", "standard"), "frontier")
})

test("escalation is monotonic and capped", () => {
  assert.equal(escalate("fast"), "standard")
  assert.equal(escalate("standard"), "frontier")
  assert.equal(escalate("frontier"), "frontier")
})
