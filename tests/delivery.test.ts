import test from "node:test"
import assert from "node:assert/strict"
import { deliveryAuthorization, deliveryCapability, evaluateDelivery } from "../src/capabilities/delivery/index.ts"
import { contractKey, createTaskContract, type TaskContract } from "../src/core/task-contract.ts"

function createMemoryState() {
  const map = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> { return map.get(key) as T | undefined },
    async set<T>(key: string, value: T): Promise<void> { map.set(key, value) },
    async remove(key: string): Promise<void> { map.delete(key) },
    async scan<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
      return [...map.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: value as T }))
    },
  }
}

function createToolHarness(messages: any[]) {
  const tools = new Map<string, any>()
  const ctx: any = {
    session: { async context() { return messages } },
    tool: {
      async transform(cb: (editor: any) => void) {
        cb({ namespace() {}, add(def: any) { tools.set(def.name, def) } })
        return { dispose() {} }
      },
    },
  }
  return { ctx, tools }
}

function completedContract(sessionID: string): TaskContract {
  const result = createTaskContract(sessionID, {
    taskKind: "feature",
    goal: "finish feature",
    requirements: ["works"],
  })
  assert.equal(result.ok, true)
  return { ...(result as { ok: true; contract: TaskContract }).contract, status: "completed" }
}

test("delivery authorization is operation-specific and explicit", () => {
  assert.equal(deliveryAuthorization("Haz commit y push", "commit").authorized, true)
  assert.equal(deliveryAuthorization("Haz commit y push", "push").authorized, true)
  assert.equal(deliveryAuthorization("Haz commit y push", "release").authorized, false)
  assert.equal(deliveryAuthorization("Termina la feature", "push").authorized, false)
  assert.equal(deliveryAuthorization("Open a pull request", "pull-request").authorized, true)
})

test("delivery authorization respects explicit negation", () => {
  assert.equal(deliveryAuthorization("No hagas push ni release", "push").reason, "explicit-negation")
  assert.equal(deliveryAuthorization("No hagas push ni release", "release").reason, "explicit-negation")
  assert.equal(deliveryAuthorization("Do not merge; create a PR instead", "merge").authorized, false)
  assert.equal(deliveryAuthorization("Do not merge; create a PR instead", "pull-request").authorized, true)
})

test("delivery readiness fails closed while Task Contract is unfinished", async () => {
  const state: any = createMemoryState()
  const created = createTaskContract("ses-1", { taskKind: "feature", goal: "x", requirements: ["y"] })
  assert.equal(created.ok, true)
  await state.set(contractKey("ses-1"), (created as { ok: true; contract: TaskContract }).contract)
  const decision = await evaluateDelivery(state, "ses-1", "haz push", "push")
  assert.equal(decision.authorization.authorized, true)
  assert.equal(decision.readiness.ready, false)
  assert.equal(decision.allowed, false)
})

test("delivery allows named operation after completed Task Contract", async () => {
  const state: any = createMemoryState()
  await state.set(contractKey("ses-1"), completedContract("ses-1"))
  const decision = await evaluateDelivery(state, "ses-1", "push y crea un PR", "push")
  assert.equal(decision.allowed, true)
  assert.equal(decision.readiness.source, "completed-task-contract")
  assert.equal(decision.execution, "opencode-native")
})

test("delivery permits explicit operational continuation without a Task Contract but does not claim completion proof", async () => {
  const state: any = createMemoryState()
  const decision = await evaluateDelivery(state, "ses-1", "crea el tag v1.2.3", "tag")
  assert.equal(decision.allowed, true)
  assert.equal(decision.readiness.taskContract, "absent")
  assert.equal(decision.readiness.source, "explicit-operational-continuation")
  assert.match(decision.readiness.note ?? "", /inspect native repository state/i)
})

test("andmar_delivery reads the current raw user request instead of accepting caller authorization", async () => {
  const state: any = createMemoryState()
  await state.set(contractKey("ses-1"), completedContract("ses-1"))
  const { ctx, tools } = createToolHarness([
    { id: "u1", type: "user", text: "haz push pero no hagas release" },
    { id: "a1", type: "assistant", text: "" },
  ])
  await deliveryCapability.setup({ ctx, state, config: {} as any })
  const delivery = tools.get("delivery")
  assert.ok(delivery)
  const push = JSON.parse((await delivery.execute({ operation: "push" }, { sessionID: "ses-1", messageID: "a1" })).content)
  const release = JSON.parse((await delivery.execute({ operation: "release" }, { sessionID: "ses-1", messageID: "a1" })).content)
  assert.equal(push.allowed, true)
  assert.equal(release.allowed, false)
  assert.equal(release.authorization.reason, "explicit-negation")
})
