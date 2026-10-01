import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import {
  type DecisionLedgerEntry,
  type DecisionLedgerEntryWithOutcome,
  type DecisionOutcome,
  PROMPT_EXCERPT_CAP,
} from "./types"

export class DecisionLedgerError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = "DecisionLedgerError"
  }
}

export type DecisionLedgerDeps = {
  filePath?: string
  maxFileBytes?: number
  now?: () => number
}

export type DecisionLedgerRecordInput = Omit<DecisionLedgerEntry, "id" | "ts">

const DEFAULT_FILE_PATH = join(homedir(), ".omo", "decision-ledger.jsonl")
const DEFAULT_MAX_FILE_BYTES = 10_485_760
const BUDGET_FILE_SUFFIX = "-budget.json"

function budgetFilePath(ledgerPath: string): string {
  return ledgerPath.replace(/\.jsonl$/, "") + BUDGET_FILE_SUFFIX
}

function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

type BudgetState = { month: string; spendUsd: number }

export type DecisionLedger = {
  record(entry: DecisionLedgerRecordInput): { id: string; ts: number }
  backfillOutcome(outcome: Omit<DecisionOutcome, "ts">): boolean
  accumulate(costUsd: number): void
  monthlySpendUsd(): number
  readAll(): DecisionLedgerEntryWithOutcome[]
}

export function createDecisionLedger(deps: DecisionLedgerDeps = {}): DecisionLedger {
  const filePath = deps.filePath ?? DEFAULT_FILE_PATH
  const maxFileBytes = deps.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const now = deps.now ?? Date.now

  function ensureParentDir(): void {
    const directory = dirname(filePath)
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true })
    }
  }

  // One-deep rotation: when the active ledger hits maxFileBytes we rename it to
  // `${filePath}.1` and start a fresh file. We intentionally do NOT shift
  // `.1` -> `.2` (the prior `.1` is overwritten). The future wiring PR can add
  // deeper rotation if retention requires it.
  function rotateIfNeeded(): void {
    if (!existsSync(filePath)) return
    let size: number
    try {
      size = statSync(filePath).size
    } catch (error) {
      throw new DecisionLedgerError("Failed to stat ledger file", error)
    }
    if (size >= maxFileBytes) {
      try {
        renameSync(filePath, `${filePath}.1`)
      } catch (error) {
        throw new DecisionLedgerError("Failed to rotate ledger file", error)
      }
    }
  }

  function record(entry: DecisionLedgerRecordInput): { id: string; ts: number } {
    const id = randomUUID()
    const ts = now()
    const cappedExcerpt =
      entry.task.promptExcerpt.length > PROMPT_EXCERPT_CAP
        ? entry.task.promptExcerpt.slice(0, PROMPT_EXCERPT_CAP)
        : entry.task.promptExcerpt
    const full: DecisionLedgerEntry = {
      ...entry,
      id,
      ts,
      task: { description: entry.task.description, promptExcerpt: cappedExcerpt },
    }
    const line = JSON.stringify(full)
    try {
      ensureParentDir()
      rotateIfNeeded()
      appendFileSync(filePath, `${line}\n`, "utf-8")
    } catch (error) {
      throw new DecisionLedgerError("Failed to append ledger entry", error)
    }
    return { id, ts }
  }

  function readLines(): DecisionLedgerEntryWithOutcome[] {
    if (!existsSync(filePath)) return []
    let raw: string
    try {
      raw = readFileSync(filePath, "utf-8")
    } catch (error) {
      throw new DecisionLedgerError("Failed to read ledger file", error)
    }
    const entries: DecisionLedgerEntryWithOutcome[] = []
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        entries.push(JSON.parse(trimmed) as DecisionLedgerEntryWithOutcome)
      } catch (error) {
        throw new DecisionLedgerError("Failed to parse ledger line", error)
      }
    }
    return entries
  }

  function backfillOutcome(outcome: Omit<DecisionOutcome, "ts">): boolean {
    const entries = readLines()
    const index = entries.findIndex(e => e.id === outcome.decisionId)
    if (index === -1) return false
    const full: DecisionOutcome = { ...outcome, ts: now() }
    entries[index] = { ...entries[index], outcome: full }
    try {
      ensureParentDir()
      const serialized = entries.map(e => JSON.stringify(e)).join("\n") + "\n"
      writeFileSync(filePath, serialized, "utf-8")
    } catch (error) {
      throw new DecisionLedgerError("Failed to rewrite ledger with outcome", error)
    }
    return true
  }

  function readBudgetState(): BudgetState {
    const budgetPath = budgetFilePath(filePath)
    const currentMonth = monthKey(now())
    let state: BudgetState = { month: currentMonth, spendUsd: 0 }
    if (existsSync(budgetPath)) {
      try {
        const parsed = JSON.parse(readFileSync(budgetPath, "utf-8")) as Partial<BudgetState>
        if (parsed && typeof parsed.month === "string" && typeof parsed.spendUsd === "number") {
          state = { month: parsed.month, spendUsd: parsed.spendUsd }
        }
      } catch (error) {
        throw new DecisionLedgerError("Failed to read budget state", error)
      }
    }
    if (state.month !== currentMonth) {
      state = { month: currentMonth, spendUsd: 0 }
      try {
        writeFileSync(budgetPath, JSON.stringify(state), "utf-8")
      } catch (error) {
        throw new DecisionLedgerError("Failed to reset budget state", error)
      }
    }
    return state
  }

  function accumulate(costUsd: number): void {
    const state = readBudgetState()
    state.spendUsd += costUsd
    const budgetPath = budgetFilePath(filePath)
    try {
      writeFileSync(budgetPath, JSON.stringify(state), "utf-8")
    } catch (error) {
      throw new DecisionLedgerError("Failed to persist budget state", error)
    }
  }

  function monthlySpendUsd(): number {
    return readBudgetState().spendUsd
  }

  return { record, backfillOutcome, accumulate, monthlySpendUsd, readAll: readLines }
}
