import type { ModelProfile, TaskSignals } from "./contracts.ts"

const rank: Record<ModelProfile, number> = { fast: 0, standard: 1, frontier: 2 }
const byRank: ModelProfile[] = ["fast", "standard", "frontier"]

export function minimumProfile(task: TaskSignals): ModelProfile {
  const risk = task.risk ?? "low"
  const uncertainty = task.uncertainty ?? "low"
  const reasoning = task.reasoning ?? "low"
  const scope = task.scopeFiles ?? 1
  const failures = task.verificationFailures ?? 0

  if (
    task.kind === "architecture" ||
    task.kind === "security" ||
    task.kind === "migration" ||
    risk === "critical" ||
    (risk === "high" && task.externalSideEffects)
  ) {
    return "frontier"
  }

  if (failures >= 2 || (task.kind === "debug" && uncertainty === "high") || reasoning === "high") {
    return "frontier"
  }

  const trivial = ["trivial-ui", "docs-format", "known-test", "internal"].includes(task.kind)
  if (
    trivial &&
    scope <= 3 &&
    risk === "low" &&
    uncertainty === "low" &&
    !task.publicApi &&
    !task.externalSideEffects &&
    failures === 0
  ) {
    return "fast"
  }

  return "standard"
}

export function clampRequestedProfile(requested: ModelProfile | undefined, minimum: ModelProfile): ModelProfile {
  if (!requested) return minimum
  return rank[requested] >= rank[minimum] ? requested : minimum
}

export function escalate(profile: ModelProfile): ModelProfile {
  return byRank[Math.min(rank[profile] + 1, byRank.length - 1)] ?? "frontier"
}
