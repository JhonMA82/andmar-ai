import test from "node:test"
import assert from "node:assert/strict"
import { globMatch } from "../src/core/glob.ts"

test("supports star and double-star patterns", () => {
  assert.equal(globMatch("src/**", "src/api/users.ts"), true)
  assert.equal(globMatch("src/*.ts", "src/index.ts"), true)
  assert.equal(globMatch("src/*.ts", "src/api/index.ts"), false)
})
