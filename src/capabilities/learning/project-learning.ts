import { readFile, lstat } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { Registry, atomicWrite, managedSkillPath, recordID } from "./persistence.ts"
import { LIMITS, lessonText, equivalent } from "./safety.ts"

export type LessonKind = "TOOL_FAILURE" | "RECOVERED_FAILURE" | "USER_CORRECTION" | "TECHNIQUE" | "SKILL_WRONG"
export interface LessonInput {
  kind: LessonKind
  problem: string
  solution: string
  evidence: string
  source: "observed-pair" | "foreground-validated"
}
export interface Lesson extends LessonInput {
  id: string; fingerprint: string; hits: number; lastSeen: number
  status: "pending" | "dropped" | "promoted" | "merged"
  skill?: string; skillDigest?: string; preparedDigest?: string; preparedSkill?: string; preparedSourceDigest?: string
}
interface Lessons {
  version: 1; lessons: Lesson[]
  audit: Array<{ at: number; lesson: string; action: string; reason: string }>
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex")

export class ProjectLearning {
  readonly registry: Registry<Lessons>
  readonly root: string
  constructor(root: string, notice: (message: string) => void) {
    this.root = root
    this.registry = new Registry(root, "learning", () => ({ version: 1, lessons: [], audit: [] }),
      (v: any): v is Lessons => v?.version === 1 && Array.isArray(v.lessons) && v.lessons.length <= LIMITS.pendingLessons + LIMITS.lessonHistory && Array.isArray(v.audit) && v.audit.length <= LIMITS.audit && v.lessons.every((x: any) =>
        typeof x.id === "string" && typeof x.problem === "string" && typeof x.solution === "string" && typeof x.evidence === "string" && ["pending", "dropped", "promoted", "merged"].includes(x.status) && Number.isInteger(x.hits) && typeof x.fingerprint === "string"), notice)
  }

  private audit(data: Lessons, lesson: Lesson, action: string, reason: string) {
    data.audit.push({ at: Date.now(), lesson: lesson.id, action, reason: lessonText(reason, LIMITS.summaryChars) })
    data.audit = data.audit.slice(-LIMITS.audit)
    data.lessons = [...data.lessons.filter(x => x.status !== "pending").slice(-LIMITS.lessonHistory), ...data.lessons.filter(x => x.status === "pending")]
  }

  async candidate(input: LessonInput): Promise<Lesson | null> {
    if (input.kind === "TOOL_FAILURE") return null // unresolved failures stay transient
    if (!["RECOVERED_FAILURE", "USER_CORRECTION", "TECHNIQUE", "SKILL_WRONG"].includes(input.kind) || !["observed-pair", "foreground-validated"].includes(input.source)) throw new Error("Invalid lesson provenance")
    const safe = { kind: input.kind, source: input.source,
      problem: lessonText(input.problem, LIMITS.observationChars),
      solution: lessonText(input.solution, LIMITS.observationChars),
      evidence: lessonText(input.evidence, LIMITS.evidenceChars) }
    return this.registry.update(data => {
      const fp = digest(`${safe.kind}|${safe.problem.toLowerCase()}|${safe.solution.toLowerCase()}`).slice(0, 20)
      const existing = data.lessons.find(x => x.fingerprint === fp || x.kind === safe.kind && equivalent(x.problem + " " + x.solution, safe.problem + " " + safe.solution))
      if (existing) {
        existing.hits++; existing.lastSeen = Date.now()
        return existing.status === "dropped" ? null : existing
      }
      if (data.lessons.filter(x => x.status === "pending").length >= LIMITS.pendingLessons) return null
      const lesson: Lesson = { ...safe, id: recordID("PL"), fingerprint: fp, hits: 1, lastSeen: Date.now(), status: "pending" }
      data.lessons.push(lesson)
      // Tombstones suppress rediscovery while retained; never unbounded.
      const historical = data.lessons.filter(x => x.status !== "pending").slice(-LIMITS.lessonHistory)
      data.lessons = [...historical, ...data.lessons.filter(x => x.status === "pending")]
      this.audit(data, lesson, "capture", "Validated pair or explicit foreground conclusion")
      return lesson
    })
  }

  pending() { return this.registry.update(data => data.lessons.filter(x => x.status === "pending")) }

  async drop(id: string, reason: string) {
    return this.registry.update(data => {
      const lesson = data.lessons.find(x => x.id === id)
      if (!lesson || lesson.status !== "pending") throw new Error("Pending lesson not found")
      lesson.status = "dropped"
      this.audit(data, lesson, "drop", reason)
      return lesson
    })
  }

  /** Foreground semantic decision. No supplied output/web/file source is accepted. */
  async promote(input: { id: string; name: string; description: string; procedure: string; evidence: string; validated: boolean; source: string; mergeInto?: string }) {
    if (input.validated !== true || input.source !== "foreground-validated") throw new Error("Promotion requires an explicitly validated foreground conclusion")
    const description = lessonText(input.description, 300).replace(/\s+/g, " ")
    const procedure = lessonText(input.procedure, LIMITS.skillChars)
    const evidence = lessonText(input.evidence, LIMITS.evidenceChars)
    const rendered = `---\nname: ${input.name}\ndescription: ${JSON.stringify(description)}\n---\n\n${procedure}\n`
    // Plan and audit before publishing a second file. An identical prepared
    // request can reconcile a file published immediately before a process crash.
    const directory = await managedSkillPath(this.root, input.name)
    const path = join(directory, "SKILL.md")
    const readSkill = async (): Promise<string | undefined> => {
      try {
        const info = await lstat(path)
        if (!info.isFile() || info.isSymbolicLink() || info.size > LIMITS.skillChars * 2) throw new Error("Unsafe skill file")
        return await readFile(path, "utf8")
      } catch (error: any) { if (error.code === "ENOENT") return undefined; throw error }
    }
    const plan = await this.registry.update(async data => {
      const lesson = data.lessons.find(x => x.id === input.id)
      if (!lesson || lesson.status !== "pending") throw new Error("Pending lesson not found")
      lesson.problem = lessonText(lesson.problem, LIMITS.observationChars)
      lesson.solution = lessonText(lesson.solution, LIMITS.observationChars)
      lesson.evidence = lessonText(lesson.evidence, LIMITS.evidenceChars)
      const owner = input.mergeInto ? data.lessons.find(x => x.id === input.mergeInto && x.status === "promoted") : undefined
      if (input.mergeInto && (!owner || owner.skill !== input.name)) throw new Error("Merge target must be a skill owned by this registry")
      if (!input.mergeInto && data.lessons.some(x => x.id !== lesson.id && x.status === "promoted" && equivalent(x.problem + " " + x.solution, lesson.problem + " " + lesson.solution))) throw new Error("Equivalent promoted lesson exists; use explicit merge")
      const previous = await readSkill()
      const previousDigest = previous === undefined ? undefined : digest(previous)
      const reconcile = previous !== undefined && lesson.preparedSkill === input.name && lesson.preparedDigest === previousDigest && lesson.preparedSourceDigest === digest(rendered)
      let content = rendered
      if (owner) {
        if (reconcile) content = previous!
        else {
          if (previous === undefined || previousDigest !== owner.skillDigest) throw new Error("Refusing to modify a foreign or edited skill")
          content = `${previous.trim()}\n\n${procedure}\n`
        }
      } else if (previous !== undefined) {
        if (!reconcile) throw new Error("Refusing to overwrite an existing native skill")
        content = previous
      }
      if (content.length > LIMITS.skillChars) throw new Error("Skill write budget exceeded")
      lessonText(content, LIMITS.skillChars)
      lesson.preparedDigest = digest(content); lesson.preparedSkill = input.name; lesson.preparedSourceDigest = digest(rendered)
      this.audit(data, lesson, "prepare-promotion", evidence)
      return { ownerID: owner?.id, content, previousDigest }
    })
    return this.registry.update(async data => {
      const lesson = data.lessons.find(x => x.id === input.id)
      if (!lesson || lesson.status !== "pending" || lesson.preparedDigest !== digest(plan.content)) throw new Error("Promotion state changed; reconcile first")
      const previous = await readSkill()
      if ((previous === undefined ? undefined : digest(previous)) !== plan.previousDigest) throw new Error("Skill changed during publication; reconcile first")
      const owner = plan.ownerID ? data.lessons.find(x => x.id === plan.ownerID && x.status === "promoted") : undefined
      if (plan.ownerID && !owner) throw new Error("Owned merge target changed")
      await atomicWrite(path, plan.content)
      if (owner) owner.skillDigest = digest(plan.content)
      lesson.skill = input.name; lesson.skillDigest = digest(plan.content)
      lesson.status = owner ? "merged" : "promoted"
      delete lesson.preparedDigest; delete lesson.preparedSkill; delete lesson.preparedSourceDigest
      this.audit(data, lesson, lesson.status, evidence)
      return { lesson, skill: `.opencode/skills/${input.name}/SKILL.md` }
    })
  }
}
