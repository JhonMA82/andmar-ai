import { Registry, recordID } from "./persistence.ts"
import { LIMITS, clean, fingerprint } from "./safety.ts"

export interface IncidentInput {
  flow: string; workId?: string; workUnit?: string; expected: string
  lastSuccess: string; failedAt: string; component: string; category: string
  error: string; recoverable: boolean; evidence?: string
  severe?: boolean; manualIntervention?: boolean
}
export interface Incident extends IncidentInput {
  id: string; at: number; lastSeen: number; andmarVersion: string; opencodeVersion: string
  fingerprint: string; occurrences: number; status: "open" | "resolved"
  regressionCandidate: boolean; recovery?: string; recoveredAt?: number; recoveryEvidence?: string
}
// These are outcome explanations, never a second authority for Ledger state.
export type Outcome = "completed" | "cancelled-by-user" | "blocked-external" | "failed-project" | "failed-andmar"
export interface RunReference {
  workId: string; workUnit: string; lastSuccess: string; expected: string
  owner: string; at: number; outcome?: Outcome; explanation?: string; incident?: string
}
interface Incidents { version: 1; incidents: Incident[]; runs: RunReference[] }

export class RuntimeIncidents {
  readonly registry: Registry<Incidents>
  readonly versions: { andmar: string; opencode: string }
  readonly notice: (message: string) => void
  constructor(root: string, versions: { andmar: string; opencode: string }, notice: (message: string) => void) {
    this.versions = versions; this.notice = notice
    this.registry = new Registry(root, "incidents", () => ({ version: 1, incidents: [], runs: [] }),
      (v: any): v is Incidents => v?.version === 1 && Array.isArray(v.incidents) && v.incidents.length <= LIMITS.incidents + LIMITS.resolvedIncidents && Array.isArray(v.runs) && v.runs.length <= LIMITS.runs && v.incidents.every((x: any) =>
        typeof x.id === "string" && typeof x.fingerprint === "string" && typeof x.error === "string" && typeof x.component === "string" && ["open", "resolved"].includes(x.status) && Number.isInteger(x.occurrences)) && v.runs.every((x: any) => typeof x.workId === "string" && typeof x.owner === "string" && typeof x.expected === "string"), notice)
  }

  private record(data: Incidents, input: IncidentInput): Incident {
    const safe: IncidentInput = { flow: clean(input.flow), expected: clean(input.expected), lastSuccess: clean(input.lastSuccess), failedAt: clean(input.failedAt), component: clean(input.component), category: clean(input.category), error: clean(input.error), recoverable: input.recoverable === true,
      ...(input.workId ? { workId: clean(input.workId) } : {}), ...(input.workUnit ? { workUnit: clean(input.workUnit) } : {}),
      ...(input.evidence ? { evidence: clean(input.evidence, LIMITS.evidenceChars) } : {}) }
    const fp = fingerprint(safe.component, safe.failedAt, safe.category, safe.error)
    let incident = data.incidents.find(x => x.fingerprint === fp)
    if (incident) {
      incident.occurrences++; incident.lastSeen = Date.now(); incident.status = "open"
      // Latest recurrence's work pointer replaces temporary context, not its history.
      Object.assign(incident, safe)
    } else {
      if (data.incidents.filter(x => x.status === "open").length >= LIMITS.incidents) throw new Error("Open incident budget reached; archive or resolve incidents")
      incident = { ...safe, id: recordID("INC"), at: Date.now(), lastSeen: Date.now(),
        andmarVersion: clean(this.versions.andmar), opencodeVersion: clean(this.versions.opencode),
        fingerprint: fp, occurrences: 1, status: "open", regressionCandidate: false }
      data.incidents.push(incident)
    }
    incident.regressionCandidate ||= incident.occurrences > 1 || input.severe === true || input.manualIntervention === true || input.category === "invalid-transition"
    if (safe.workId) {
      const run = data.runs.find(x => x.workId === safe.workId)
      if (run) run.incident = incident.id
    }
    return incident
  }

  async recordIncident(input: IncidentInput) {
    const incident = await this.registry.update(data => this.record(data, input))
    this.notice(`AndMar: runtime incident ${incident.id} recorded — ${incident.component} could not continue.`)
    return incident
  }
  list() { return this.registry.update(data => ({ incidents: data.incidents, executions: data.runs })) }

  async resolve(id: string, recovery: string, evidence: string) {
    if (!recovery.trim() || !evidence.trim()) throw new Error("Recovery action and verification evidence are required")
    const incident = await this.registry.update(data => {
      const incident = data.incidents.find(x => x.id === id)
      if (!incident) throw new Error("Incident not found")
      incident.recovery = clean(recovery); incident.recoveryEvidence = clean(evidence, LIMITS.evidenceChars)
      incident.recoveredAt = Date.now(); incident.status = "resolved"
      data.incidents = [...data.incidents.filter(x => x.status === "open"), ...data.incidents.filter(x => x.status === "resolved").sort((a, b) => (a.recoveredAt ?? 0) - (b.recoveredAt ?? 0)).slice(-LIMITS.resolvedIncidents)]
      return incident
    })
    this.notice(`AndMar: ${incident.id} resolved — recovery evidence recorded.`)
    return incident
  }

  /** Persist only references to the owning Ledger and observed transitions. */
  async transition(input: { workId: string; workUnit?: string; action: string; next?: string }, owner: string) {
    return this.registry.update(data => {
      let run = data.runs.find(x => x.workId === input.workId)
      let interrupted: Incident | undefined
      if (input.action === "work.started" && run && !run.outcome && run.owner !== owner) {
        // Unknown cause is explicitly unknown, never silently called failed-AndMar.
        interrupted = this.record(data, { flow: "work.execute", workId: run.workId, workUnit: run.workUnit,
          expected: run.expected, lastSuccess: run.lastSuccess, failedAt: "resume", component: "lifecycle",
          category: "interrupted-run", error: "Previous observed work execution has no terminal explanation; cause unknown", recoverable: true })
      }
      if (!run) {
        if (data.runs.length >= LIMITS.runs) {
          const terminal = data.runs.findIndex(x => x.outcome)
          if (terminal < 0) throw new Error("Unfinished execution reference budget reached; reconcile work outcomes")
          data.runs.splice(terminal, 1)
        }
        run = { workId: clean(input.workId), workUnit: clean(input.workUnit), lastSuccess: "work.started", expected: "execute → verify → completion → finalize", owner, at: Date.now() }
        data.runs.push(run)
      }
      run.owner = owner; run.at = Date.now()
      run.workUnit = clean(input.workUnit ?? run.workUnit)
      if (input.action !== "work.started" || !interrupted) run.lastSuccess = clean(input.action)
      run.expected = clean(input.next ?? "execute → verify → completion → finalize")
      if (input.action === "work.completed") { run.outcome = "completed"; run.explanation = "Owning Work Ledger reached completed" }
      return { run, interrupted }
    })
  }

  async outcome(workId: string, outcome: Outcome, explanation: string) {
    if (!["completed", "cancelled-by-user", "blocked-external", "failed-project", "failed-andmar"].includes(outcome) || !explanation.trim()) throw new Error("Explicit outcome and explanation required")
    // Completion can only be observed from Ledger; caller claims cannot grant it.
    if (outcome === "completed") throw new Error("Completed is derived from the owning Work Ledger")
    return this.registry.update(data => {
      const run = data.runs.find(x => x.workId === workId)
      if (!run) throw new Error("Observed work reference not found")
      run.outcome = outcome; run.explanation = clean(explanation); run.at = Date.now()
      return run
    })
  }
}
