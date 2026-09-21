import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "js-yaml"
import { z } from "zod"

export const workflowStepSchema = z.object({
  id: z.string().optional(), uses: z.string().optional(), run: z.string().optional(),
  if: z.string().optional(), "continue-on-error": z.boolean().optional(),
  env: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String)).optional(),
  with: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

export function readWorkflowSteps(filename: string, job: string) {
  const workflow = z.object({ jobs: z.record(z.string(), z.object({ steps: z.array(workflowStepSchema) })) })
    .parse(load(readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), "utf8")))
  const selected = workflow.jobs[job]
  if (selected === undefined) throw new Error(`missing workflow job ${job}`)
  return selected.steps
}

type GateScenario = {
  readonly name: string
  readonly receipt?: string
  readonly workerExit?: number
  readonly captureExit?: number
  readonly accepted: boolean
}

export function receiptGateScenarios(names: readonly string[]): readonly GateScenario[] {
  const cases = names.map((name) => ({ case: name, pass: true, exitCode: 0 }))
  const passing = { complete: true, pass: true, cases }
  return [
    { name: "passing receipts", receipt: JSON.stringify(passing), accepted: true },
    { name: "missing receipt", accepted: false },
    { name: "malformed receipt", receipt: "{", accepted: false },
    { name: "incomplete capture", receipt: JSON.stringify({ ...passing, complete: false }), accepted: false },
    { name: "failed summary", receipt: JSON.stringify({ ...passing, pass: false }), accepted: false },
    { name: "failed smoke leg despite passing summary", receipt: JSON.stringify({ ...passing, cases: cases.map((row, index) => index === 0 ? { ...row, pass: false } : row) }), accepted: false },
    { name: "nonzero smoke exit despite passing summary", receipt: JSON.stringify({ ...passing, cases: cases.map((row, index) => index === 0 ? { ...row, exitCode: 1 } : row) }), accepted: false },
    { name: "missing selected case", receipt: JSON.stringify({ ...passing, cases: cases.slice(1) }), accepted: false },
    { name: "duplicate selected cases", receipt: JSON.stringify({ ...passing, cases: cases.concat(cases) }), accepted: false },
    { name: "failed capture with stale passing receipts", receipt: JSON.stringify(passing), captureExit: 23, accepted: false },
  ]
}

export function runReceiptGate(command: string, scenario: GateScenario, target = "darwin-arm64") {
  const root = mkdtempSync(join(tmpdir(), "omo-receipt-gate-"))
  try {
    if (scenario.receipt !== undefined) writeFileSync(join(root, "fixture.json"), scenario.receipt)
    // Only expensive Bun probes are substituted. Bash, jq, the workflow's entire
    // run block, and errexit/pipefail are real, including any accidental || true.
    const script = `
      bun() {
        if [[ "$1" == test ]]; then return "$WORKER_EXIT"; fi
        if [[ "$1" != script/qa/dependency-audit-capture.ts ]]; then return 64; fi
        printf '%s\\n' "$@" > "$CAPTURE_ARGS"
        local out=""
        while [[ "$#" -gt 0 ]]; do
          if [[ "$1" == --out ]]; then out="$2"; shift; fi
          shift
        done
        mkdir -p "$out"
        if [[ -f "$FIXTURE" ]]; then cp "$FIXTURE" "$out/summary.json"; fi
        return "$CAPTURE_EXIT"
      }
      ${command.replaceAll("${{ matrix.platform }}", target).replaceAll("${{ matrix.binary }}", `omo-${target}${target.startsWith("windows-") ? ".exe" : ""}`)}
      touch "$REACHED"
    `
    const path = root.replaceAll("\\", "/")
    const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
      cwd: root, encoding: "utf8", timeout: 20_000,
      env: {
        ...process.env, OUT_DIR: `${path}/out`, SMOKE_DIR: `${path}/smoke`,
        FIXTURE: `${path}/fixture.json`, CAPTURE_ARGS: `${path}/args`, REACHED: `${path}/reached`,
        WORKER_EXIT: String(scenario.workerExit ?? 0), CAPTURE_EXIT: String(scenario.captureExit ?? 0),
      },
    })
    if (result.error !== undefined) throw result.error
    return {
      status: result.status, stderr: result.stderr, reached: existsSync(join(root, "reached")),
      captureArgs: existsSync(join(root, "args")) ? readFileSync(join(root, "args"), "utf8").trim().split("\n") : [],
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
