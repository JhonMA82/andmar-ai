import { createHash } from "node:crypto"

export const LIMITS = {
  sessions: 8, observations: 32, observationChars: 400,
  pendingLessons: 64, lessonHistory: 128, incidents: 64,
  resolvedIncidents: 64, runs: 64, summaryChars: 400,
  evidenceChars: 800, skillChars: 6000, registryBytes: 256 * 1024, audit: 128,
} as const

const injection = /ignore\s+(?:(?:all|the|any)\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)|(?:ignora|omite)\s+(?:todas?\s+)?(?:las?\s+)?(?:instrucciones|reglas)\s+(?:anteriores|previas)|(?:^|\n)\s*(?:system|developer|assistant)\s*:|<\/?(?:system|developer|assistant|im_start|tool_use)\b|\[INST\]|you are now|do not (?:tell|inform) the user|reveal (?:the )?(?:system prompt|secrets)/i

/** Applied again at every durable write, including explicit foreground input. */
export function clean(value: unknown, max: number = LIMITS.summaryChars): string {
  return String(value ?? "")
    .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g, "[secret]")
    .replace(/\b(?:sk-[\w-]{8,}|gh[pousr]_[\w]{8,}|github_pat_[\w_]{8,}|AKIA[A-Z0-9]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, "[secret]")
    .replace(/\b(?:bearer\s+|(?:[\w-]*(?:api[_-]?key|token|password|secret)[\w-]*)\s*[=:]\s*)["']?[^\s"',;]+["']?/gi, "[secret]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi, "[credential-url]")
    .replace(/(?:[A-Za-z]:[\\/]|\/)[\w.@~-]+(?:[\\/][\w.@~+-]+)+/g, "[path]")
    .replace(/\b(?:ses|msg|call|task|tmp)[_-][\w-]+\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[0-9a-f]{24,}\b/gi, "[temporary-id]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim().slice(0, max)
}

export function lessonText(value: unknown, max: number): string {
  const raw = String(value ?? "")
  if (raw.length > max) throw new Error("Learning content exceeds its write budget")
  if (injection.test(raw)) throw new Error("Learning content rejected: instruction injection")
  const text = clean(raw, max)
  if (!text || text === "[secret]" || text === "[path]") throw new Error("Learning requires concrete sanitized content")
  return text
}

export function fingerprint(...values: string[]): string {
  return createHash("sha256").update(values.map(v => clean(v, LIMITS.skillChars)
    .toLowerCase().replace(/\b\d{4}-\d{2}-\d{2}[t ][\d:.+-]+z?\b/g, "[time]").replace(/\b\d+\b/g, "#").replace(/\s+/g, " ")).join("|")).digest("hex").slice(0, 20)
}

export function equivalent(left: string, right: string): boolean {
  // Version constraints carry meaning; token overlap must not erase them.
  const versions = (text: string) => (text.match(/\b\d+(?:\.\d+)+\b/g) ?? []).join("|")
  if (versions(left) !== versions(right)) return false
  const tokens = (text: string) => new Set(clean(text, LIMITS.skillChars).toLowerCase().match(/[a-z][a-z0-9_-]+/g) ?? [])
  const a = tokens(left), b = tokens(right)
  if (a.size < 4 || b.size < 4) return left === right
  const overlap = [...a].filter(token => b.has(token)).length
  return overlap / new Set([...a, ...b]).size >= 0.85
}
