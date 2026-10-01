import type { ChangeKind, DocumentationRule } from "../../core/contracts.ts"
import { matchesAny } from "../../core/glob.ts"

export interface DocumentationImpact {
  status: "clean" | "stale" | "not-applicable"
  affectedRuleIDs: string[]
  expectedDocs: string[]
}

export function analyzeDocumentationImpact(changedPaths: string[], rules: DocumentationRule[]): DocumentationImpact {
  const affected = rules.filter((rule) => changedPaths.some((path) => matchesAny(rule.code, path)))
  if (affected.length === 0) return { status: "not-applicable", affectedRuleIDs: [], expectedDocs: [] }

  const expectedDocs = [...new Set(affected.flatMap((rule) => rule.docs))]
  const docsChanged = affected.every((rule) =>
    changedPaths.some((path) => matchesAny(rule.docs, path)),
  )

  return {
    status: docsChanged ? "clean" : "stale",
    affectedRuleIDs: affected.map((rule) => rule.id),
    expectedDocs,
  }
}

export type VersionImpact = "none" | "patch" | "minor" | "major"

export function inferVersionImpact(input: {
  kind: ChangeKind
  touchesPublicSurface: boolean
  breaking?: boolean
}): VersionImpact {
  if (!input.touchesPublicSurface) return "none"
  if (input.breaking) return "major"
  if (input.kind === "feature") return "minor"
  if (["bugfix", "refactor", "security", "migration"].includes(input.kind)) return "patch"
  return "none"
}
