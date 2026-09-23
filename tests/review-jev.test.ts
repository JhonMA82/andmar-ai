import test from "node:test"
import assert from "node:assert/strict"
import { createTaskContract, type TaskContract } from "../src/core/task-contract.ts"
import { routeReviewWithJev } from "../src/capabilities/task-contract/review-jev.ts"

function featureContract(): TaskContract {
  const result = createTaskContract("review-router-test", {
    taskKind: "feature",
    goal: "Add bounded feature",
    requirements: ["works"],
  })
  assert.equal(result.ok, true)
  return (result as { ok: true; contract: TaskContract }).contract
}

async function withKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.OPENROUTER_API_KEY
  if (value === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = value
  try { return await fn() } finally {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = prev
  }
}

test("review Jev fallback never blocks and keeps deterministic audit", async () => {
  await withKey(undefined, async () => {
    const routed = await routeReviewWithJev({
      contract: featureContract(),
      minimumMode: "audit",
      changedPaths: ["src/x.ts"],
      verificationSummary: "tests passed; runtime smoke passed",
    })
    assert.equal(routed.mode, "audit")
    assert.equal(routed.source, "fallback")
    assert.equal(routed.jevCalled, false)
  })
})

test("Jev can escalate audit to deep", async () => {
  await withKey("test-key", async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      text: async () => "ok",
      json: async () => ({
        model: "typesafe/jev-1.13",
        answers: {
          semantic_scope: { type: "choice", choice: "cross_cutting" },
          external_contract_risk: { type: "noul", noul: 0.8 },
          evidence_sufficiency: { type: "noul", noul: 0.9 },
          review_depth: { type: "choice", choice: "deep" },
        },
      }),
    })
    const routed = await routeReviewWithJev(
      {
        contract: featureContract(),
        minimumMode: "audit",
        changedPaths: ["src/x.ts"],
        verificationSummary: "tests passed; runtime smoke passed",
      },
      { fetchFn: fetchFn as never },
    )
    assert.equal(routed.mode, "deep")
    assert.equal(routed.source, "jev")
  })
})

test("Jev cannot downgrade a deterministic deep review", async () => {
  await withKey("test-key", async () => {
    let called = false
    const result = createTaskContract("security-review-router-test", {
      taskKind: "security",
      goal: "Harden auth",
      requirements: ["no bypass"],
    })
    assert.equal(result.ok, true)
    const routed = await routeReviewWithJev(
      {
        contract: (result as { ok: true; contract: TaskContract }).contract,
        minimumMode: "deep",
        changedPaths: ["src/auth.ts"],
        verificationSummary: "security tests passed",
      },
      { fetchFn: (async () => { called = true; throw new Error("must not call") }) as never },
    )
    assert.equal(routed.mode, "deep")
    assert.equal(routed.source, "deterministic")
    assert.equal(called, false)
  })
})
