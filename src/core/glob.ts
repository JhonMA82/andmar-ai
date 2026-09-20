function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&")
}

export function globMatch(pattern: string, value: string): boolean {
  const normalized = value.replaceAll("\\", "/")
  let regex = ""
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    const next = pattern[i + 1]
    if (char === "*" && next === "*") {
      regex += ".*"
      i += 1
    } else if (char === "*") {
      regex += "[^/]*"
    } else if (char === "?") {
      regex += "[^/]"
    } else {
      regex += escapeRegex(char ?? "")
    }
  }
  return new RegExp(`^${regex}$`).test(normalized)
}

export function matchesAny(patterns: string[], value: string): boolean {
  return patterns.some((pattern) => globMatch(pattern, value))
}
