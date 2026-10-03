import { mkdir, readFile, rename, rm, lstat, realpath, open } from "node:fs/promises"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { LIMITS, clean, lessonText } from "./safety.ts"

function sanitizeDurable(value: any, learning: boolean): void {
  if (!value || typeof value !== "object") return
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      // Only fixed-shape ownership digests bypass temporary-hash normalization.
      if (["skillDigest", "preparedDigest", "preparedSourceDigest"].includes(key) && /^[a-f0-9]{64}$/.test(item)) continue
      value[key] = learning ? lessonText(item, LIMITS.skillChars) : clean(item, LIMITS.skillChars)
    } else sanitizeDurable(item, learning)
  }
}

/** Reject symlink redirects, including any parent controlled by a project. */
export async function safeDirectory(root: string, segments: string[]): Promise<string> {
  let directory = await realpath(root)
  for (const segment of segments) {
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) throw new Error("Unsafe storage path")
    directory = join(directory, segment)
    await mkdir(directory).catch((error: any) => { if (error.code !== "EEXIST") throw error })
    if (!(await lstat(directory)).isDirectory() || await realpath(directory) !== directory) throw new Error("Storage path must not redirect through symlinks")
  }
  return directory
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp` // under exclusive directory lock; reusable after crash
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(content); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
}

export class Registry<T> {
  private queue = Promise.resolve()
  readonly root: string
  readonly name: string
  private empty: () => T
  private validate: (value: unknown) => value is T
  private warn: (message: string) => void
  constructor(root: string, name: string, empty: () => T,
    validate: (value: unknown) => value is T, warn: (message: string) => void) {
    this.root = root; this.name = name; this.empty = empty; this.validate = validate; this.warn = warn
  }

  async update<R>(action: (value: T) => Promise<R> | R): Promise<R> {
    const operation = this.queue.then(async () => {
      const directory = await safeDirectory(this.root, [".andmar", this.name])
      const lock = join(directory, ".write-lock")
      // No polling/retry: another writer or stale lock causes one warning, never a gate.
      await mkdir(lock)
      try {
        const path = join(directory, "records.json")
        let value = this.empty()
        try {
          const info = await lstat(path)
          if (!info.isFile() || info.isSymbolicLink() || info.size > LIMITS.registryBytes) throw new Error("Invalid registry file")
          const decoded: unknown = JSON.parse(await readFile(path, "utf8"))
          if (!this.validate(decoded)) throw new Error("Invalid registry schema")
          value = decoded
        } catch (error: any) {
          if (error.code !== "ENOENT") {
            // One quarantine slot, preserved for manual diagnosis, no raw content in warnings.
            await rename(path, join(directory, "records.corrupt")).catch(() => {})
            this.warn(`AndMar: ${this.name} registry corrupt; using a fresh registry`)
          }
        }
        const result = await action(value)
        sanitizeDurable(value, this.name === "learning")
        const serialized = JSON.stringify(value, null, 2) + "\n"
        if (Buffer.byteLength(serialized) > LIMITS.registryBytes) throw new Error("Registry write budget exceeded")
        await atomicWrite(path, serialized)
        return result
      } finally { await rm(lock, { recursive: true, force: true }) }
    })
    this.queue = operation.then(() => {}, () => {})
    return operation
  }
}

export function managedSkillPath(root: string, name: string): Promise<string> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error("Invalid native skill name")
  return safeDirectory(resolve(root), [".opencode", "skills", name])
}

export function recordID(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
}
