import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const DEFAULT_AUDIT_LEDGER_FILE = ".sisyphus/audit-loop-ledger.jsonl"
export const DEFAULT_AUDIT_CHECKPOINT_FILE = ".sisyphus/audit-loop-checkpoint.json"

export interface AuditLedgerEntry {
  timestamp: string
  session_id: string
  iteration: number
  mode?: string
  event:
    | "cycle_observed"
    | "completion_blocked"
    | "completed"
    | "timeout"
    | "max_iterations"
    | "aborted"
  focus_screen?: string
  files_changed?: string
  stagnation_detected?: boolean
  missing_gates?: string[]
}

export interface AuditCyclePolicySummary {
  focus_screen?: string
  files_changed?: string
  files: string[]
  files_key: string
  validation_pass: boolean
  regression_scan_pass: boolean
  objective_count: number
  screen_complete: boolean
}

export interface AuditCheckpointState {
  version: 1
  updated_at: string
  locked_files: string[]
  recent_cycles: AuditCyclePolicySummary[]
  consecutive_validation_failures: number
  allow_focus_progression_once: boolean
}

export function appendAuditLedgerEntry(
  directory: string,
  entry: AuditLedgerEntry,
): void {
  const ledgerPath = join(directory, DEFAULT_AUDIT_LEDGER_FILE)
  const ledgerDir = dirname(ledgerPath)
  if (!existsSync(ledgerDir)) mkdirSync(ledgerDir, { recursive: true })
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, "utf-8")
}

export function writeAuditCheckpoint(
  directory: string,
  checkpoint: AuditCheckpointState | Record<string, unknown>,
): void {
  const checkpointPath = join(directory, DEFAULT_AUDIT_CHECKPOINT_FILE)
  const checkpointDir = dirname(checkpointPath)
  if (!existsSync(checkpointDir)) mkdirSync(checkpointDir, { recursive: true })
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf-8")
}

export function extractCycleEvidenceSummary(text: string | null): {
  focus_screen?: string
  files_changed?: string
} {
  if (!text) return {}
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const focusLine = lines.find((line) => /focus screen/i.test(line))
  const filesLine = lines.find((line) => /files changed/i.test(line))

  return {
    focus_screen: focusLine,
    files_changed: filesLine,
  }
}

function lineHasPass(lines: string[], pattern: RegExp): boolean {
  return lines.some(
    (line) => pattern.test(line) && /(pass|passed|success|succeeded|ok|✅)/i.test(line),
  )
}

function extractFiles(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_./-]+\.(dart|ts|tsx|js|jsx|vue|css|scss)\b/gi) ?? []
  const unique = [...new Set(matches.map((m) => m.replace(/\\/g, "/")))]
  return unique
}

function countNextCycleTargets(lines: string[]): number {
  const sectionStart = lines.findIndex((line) => /next-cycle targets/i.test(line))
  if (sectionStart < 0) return 0
  let count = 0
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    if (/^[A-Z][A-Za-z ]+:/.test(line)) break
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) count += 1
  }
  return count
}

export function summarizeAuditCycleEvidence(text: string | null): AuditCyclePolicySummary {
  const summary = extractCycleEvidenceSummary(text)
  if (!text) {
    return {
      ...summary,
      files: [],
      files_key: "",
      validation_pass: false,
      regression_scan_pass: false,
      objective_count: 0,
      screen_complete: false,
    }
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const files = extractFiles(summary.files_changed ?? text)
  const sortedFiles = [...files].sort()

  const analyzePassed = lineHasPass(lines, /(analyze|lint)/i)
  const testPassed = lineHasPass(lines, /\btest(s)?\b/i)
  const buildPassed = lineHasPass(lines, /\bbuild\b/i)
  const regressionScanPassed = lineHasPass(lines, /regression scan/i)

  return {
    ...summary,
    files: sortedFiles,
    files_key: sortedFiles.join("|"),
    validation_pass: analyzePassed && testPassed && buildPassed,
    regression_scan_pass: regressionScanPassed,
    objective_count: countNextCycleTargets(lines),
    screen_complete: /screen complete/i.test(text),
  }
}

function defaultCheckpoint(): AuditCheckpointState {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    locked_files: [],
    recent_cycles: [],
    consecutive_validation_failures: 0,
    allow_focus_progression_once: false,
  }
}

export function readAuditCheckpoint(directory: string): AuditCheckpointState {
  const checkpointPath = join(directory, DEFAULT_AUDIT_CHECKPOINT_FILE)
  if (!existsSync(checkpointPath)) return defaultCheckpoint()

  try {
    const parsed = JSON.parse(readFileSync(checkpointPath, "utf-8")) as Partial<AuditCheckpointState>
    return {
      version: 1,
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
      locked_files: Array.isArray(parsed.locked_files)
        ? parsed.locked_files.filter((v): v is string => typeof v === "string")
        : [],
      recent_cycles: Array.isArray(parsed.recent_cycles)
        ? parsed.recent_cycles.filter((v): v is AuditCyclePolicySummary => typeof v === "object" && v !== null)
        : [],
      consecutive_validation_failures:
        typeof parsed.consecutive_validation_failures === "number"
          ? parsed.consecutive_validation_failures
          : 0,
      allow_focus_progression_once: parsed.allow_focus_progression_once === true,
    }
  } catch {
    return defaultCheckpoint()
  }
}

export function updateAuditCheckpointWithCycle(
  directory: string,
  cycle: AuditCyclePolicySummary,
): {
  checkpoint: AuditCheckpointState
  lockedFilesAdded: string[]
  forceStrategySwitch: boolean
  objectiveCapViolation: boolean
  regressionGateMissing: boolean
  allowAutoFocusProgression: boolean
} {
  const checkpoint = readAuditCheckpoint(directory)
  checkpoint.updated_at = new Date().toISOString()
  checkpoint.recent_cycles = [...checkpoint.recent_cycles, cycle].slice(-6)
  checkpoint.consecutive_validation_failures = cycle.validation_pass
    ? 0
    : checkpoint.consecutive_validation_failures + 1

  const lockedFilesAdded: string[] = []
  const lastThree = checkpoint.recent_cycles.slice(-3)
  const sameFileSet =
    lastThree.length === 3 &&
    lastThree.every((c) => c.validation_pass) &&
    lastThree.every((c) => c.files_key && c.files_key === lastThree[0].files_key)

  if (sameFileSet) {
    for (const file of lastThree[2].files) {
      if (!checkpoint.locked_files.includes(file)) {
        checkpoint.locked_files.push(file)
        lockedFilesAdded.push(file)
      }
    }
  }

  checkpoint.locked_files = [...new Set(checkpoint.locked_files)].sort()
  const allowAutoFocusProgression =
    cycle.screen_complete && cycle.validation_pass && cycle.regression_scan_pass
  checkpoint.allow_focus_progression_once = allowAutoFocusProgression
  writeAuditCheckpoint(directory, checkpoint)

  return {
    checkpoint,
    lockedFilesAdded,
    forceStrategySwitch: checkpoint.consecutive_validation_failures >= 2,
    objectiveCapViolation: cycle.objective_count > 3,
    regressionGateMissing: !cycle.regression_scan_pass,
    allowAutoFocusProgression,
  }
}
