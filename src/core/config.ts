import type { DocumentationRule, HarnessConfig, ModelRef } from "./contracts.ts"

export const defaultConfig: HarnessConfig = {
  models: {},
  delegation: {
    maxDepth: 3,
    maxResultChars: 4_000,
  },
  shell: {
    maxTimeoutMs: 120_000,
  },
  documentation: {
    rules: [],
  },
  versioning: {
    enabled: true,
    publicPaths: ["src/**", "packages/**", "apps/**"],
  },
  delivery: {
    workUnitCommits: "manual",
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function merge<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override)) return (override ?? base) as T
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key]
    result[key] = isRecord(existing) && isRecord(value) ? merge(existing, value) : value
  }
  return result as T
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`)
}

function integerInRange(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`)
  }
}

function validateModelRef(value: unknown, label: string): asserts value is ModelRef {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  nonEmptyString(value.providerID, `${label}.providerID`)
  nonEmptyString(value.id, `${label}.id`)
  if (value.variant !== undefined) nonEmptyString(value.variant, `${label}.variant`)
}

function validateStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`)
  }
}

function validateDocumentationRules(value: unknown): asserts value is DocumentationRule[] {
  if (!Array.isArray(value)) throw new Error("documentation.rules must be an array")
  const ids = new Set<string>()
  for (const [index, rule] of value.entries()) {
    if (!isRecord(rule)) throw new Error(`documentation.rules[${index}] must be an object`)
    nonEmptyString(rule.id, `documentation.rules[${index}].id`)
    if (ids.has(rule.id)) throw new Error(`documentation rule id must be unique: ${rule.id}`)
    ids.add(rule.id)
    validateStringArray(rule.code, `documentation.rules[${index}].code`)
    validateStringArray(rule.docs, `documentation.rules[${index}].docs`)
  }
}

export function validateConfig(config: HarnessConfig): HarnessConfig {
  for (const profile of ["fast", "standard", "frontier"] as const) {
    const ref = config.models[profile]
    if (ref !== undefined) validateModelRef(ref, `models.${profile}`)
  }
  integerInRange(config.delegation.maxDepth, 1, 8, "delegation.maxDepth")
  integerInRange(config.delegation.maxResultChars, 500, 50_000, "delegation.maxResultChars")
  integerInRange(config.shell.maxTimeoutMs, 1_000, 900_000, "shell.maxTimeoutMs")
  validateDocumentationRules(config.documentation.rules)
  if (typeof config.versioning.enabled !== "boolean") throw new Error("versioning.enabled must be boolean")
  validateStringArray(config.versioning.publicPaths, "versioning.publicPaths")
  if (config.delivery.workUnitCommits !== "manual" && config.delivery.workUnitCommits !== "auto") {
    throw new Error('delivery.workUnitCommits must be "manual" or "auto"')
  }
  return config
}

export function resolveConfig(options: unknown): HarnessConfig {
  return validateConfig(merge(defaultConfig, options))
}
