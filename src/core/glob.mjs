function escapeRegex(value) {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&")
}

export function globMatch(pattern, value) {
  const normalized = value.replaceAll("\\", "/")
  let regex = ""
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    const next = pattern[i + 1]
    if (char === "*" && next === "*") {
      if (pattern[i + 2] === "/") {
        regex += "(?:.*/)?"
        i += 2
      } else {
        regex += ".*"
        i += 1
      }
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

export function matchesAny(patterns, value) {
  return patterns.some((pattern) => globMatch(pattern, value))
}
