import type { LedgerResult } from "./work-ledger-lifecycle.mjs"
export function runWork(command: string, targetDir: string, input?: Record<string, any>): Promise<any>
export function compactStatus(ledger: LedgerResult): Record<string, any>
export function ledgerVersion(target: string): Promise<string>
export function createLedgerReader(): { get(target: string): Promise<LedgerResult>; invalidate(): void }
export function serializeLedger(target: string, input: Record<string, any>): Record<string, string>
export function projectContext(target: string, documents: Record<string, string>, input?: Record<string, any>): any
