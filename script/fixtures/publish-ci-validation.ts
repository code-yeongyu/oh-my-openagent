import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import contract from "../../.github/scripts/release-proof-contract.json"

// Load the same standalone Node module publish extracts from the dispatch commit.
// The JSON import supplies the contract type without a second list of jobs.
export const proofHelperUrl = new URL("../../.github/scripts/release-push-proof.mjs", import.meta.url)
export const proofHelper: {
  RELEASE_PROOF_CONTRACT: Readonly<Record<string, readonly string[]>>
  ALLOWED_SKIPS: typeof contract.allowedSkips
  materializeWorkflow(workflow: unknown): Map<string, { readonly steps: readonly string[]; readonly actions: ReadonlySet<string> }>
  verifyPushValidation(workflow: unknown, pages: unknown): string[]
} = await import(proofHelperUrl.href)
const { materializeWorkflow, RELEASE_PROOF_CONTRACT } = proofHelper

// Jobs API answers for one push CI attempt, shaped like the real run (runner setup, declared steps, post entries
// for actions, completion), synthesized from the closed-world contract and the post entries ci.yml models.

export const VALIDATIONS = [
  "passed",
  "allowed-skip",
  "skipped-job",
  "skipped-step",
  "empty-response",
  "missing-codex",
  "skipped-senpi",
  "skipped-macos-codex",
  "skipped-macos-parity",
  "skipped-windows-parity",
  "skipped-unlisted",
  "neutral-unlisted",
  "unknown-green-job",
  "unknown-skipped-job",
  "absent-senpi-build",
  "renamed-step",
  "absent-step",
  "skipped-arbitrary-step",
  "neutral-step",
  "failed-job",
  "unmodeled-post",
  "truncated-listing",
  "duplicate-job",
] as const
export type Validation = (typeof VALIDATIONS)[number]

const CI_YML = new URL("../../.github/workflows/ci.yml", import.meta.url)

export function ciWorkflow(): Record<string, unknown> {
  return Bun.YAML.parse(readFileSync(CI_YML, "utf8").replace(/\r\n/g, "\n")) as Record<string, unknown>
}

interface Step {
  name: string
  status: string
  conclusion: string
}
interface Job {
  name: string
  status: string
  conclusion: string
  steps: Step[]
}

const done = (name: string, conclusion = "success"): Step => ({ name, status: "completed", conclusion })

function passedJobs(): Job[] {
  const declared = materializeWorkflow(ciWorkflow())
  return Object.entries(RELEASE_PROOF_CONTRACT).map(([name, steps]) => {
    const actions = declared.get(name)?.actions ?? new Set<string>()
    const posts = steps.filter((step) => actions.has(step)).reverse()
    return {
      name,
      status: "completed",
      conclusion: "success",
      steps: [done("Set up job"), ...steps.map((step) => done(step)), ...posts.map((step) => done(`Post ${step}`)), done("Complete job")],
    }
  })
}

function job(jobs: Job[], name: string): Job {
  const found = jobs.find((entry) => entry.name === name)
  if (!found) throw new Error(`missing ${name} fixture`)
  return found
}

function setStep(jobs: Job[], jobName: string, stepName: string, conclusion: string): void {
  const found = job(jobs, jobName).steps.find((step) => step.name === stepName)
  if (!found) throw new Error(`missing ${jobName} / ${stepName} fixture`)
  found.conclusion = conclusion
}

function skipJob(jobs: Job[], name: string): void {
  Object.assign(job(jobs, name), { conclusion: "skipped", steps: [] })
}

function removeStep(jobs: Job[], jobName: string, stepName: string): void {
  const found = job(jobs, jobName)
  found.steps = found.steps.filter((step) => step.name !== stepName)
}

function insertBeforeSummary(jobs: Job[], jobName: string, step: Step): void {
  const steps = job(jobs, jobName).steps
  steps.splice(steps.findIndex((entry) => entry.name === "Write job summary"), 0, step)
}

const MUTATIONS: Record<Validation, (jobs: Job[]) => void> = {
  passed: () => {},
  "allowed-skip": (jobs) => {
    for (const entry of contract.allowedSkips) {
      if (!entry.steps) skipJob(jobs, entry.job)
      for (const step of entry.steps ?? []) setStep(jobs, entry.job, step, "skipped")
    }
  },
  "skipped-job": (jobs) => skipJob(jobs, "test-linux (remainder-2)"),
  "skipped-step": (jobs) => setStep(jobs, "typecheck", "Type check", "skipped"),
  "empty-response": () => {},
  "missing-codex": (jobs) => void jobs.splice(jobs.indexOf(job(jobs, "codex-compatibility (ubuntu-latest, full)")), 1),
  "skipped-senpi": (jobs) => skipJob(jobs, "senpi-compatibility (windows-latest)"),
  "skipped-macos-codex": (jobs) => setStep(jobs, "macos-combined-1", "Run Codex platform smoke", "skipped"),
  "skipped-macos-parity": (jobs) =>
    setStep(jobs, "native-binary-parity (macos-15, darwin-arm64, aarch64-apple-darwin, omo-darwin-arm64, true)", "Compare the binary with the npm launcher", "skipped"),
  "skipped-windows-parity": (jobs) =>
    setStep(jobs, "native-binary-parity (windows-latest, windows-x64, x86_64-pc-windows-msvc, omo-windows-x64.exe, f...", "Run the binary from an empty download folder twice", "skipped"),
  "skipped-unlisted": (jobs) => insertBeforeSummary(jobs, "typecheck", done("A new CI check", "skipped")),
  "neutral-unlisted": (jobs) => insertBeforeSummary(jobs, "typecheck", done("A new CI check", "neutral")),
  "unknown-green-job": (jobs) =>
    void jobs.push({ name: "surprise-check", status: "completed", conclusion: "success", steps: [done("Set up job"), done("Run it"), done("Complete job")] }),
  "unknown-skipped-job": (jobs) => void jobs.push({ name: "surprise-check", status: "completed", conclusion: "skipped", steps: [] }),
  "absent-senpi-build": (jobs) => removeStep(jobs, "senpi-eq", "Build the Senpi plugin"),
  "renamed-step": (jobs) => {
    const found = job(jobs, "build").steps.find((step) => step.name === "Verify build output")
    if (!found) throw new Error("missing build / Verify build output fixture")
    found.name = "Verify build output quickly"
  },
  "absent-step": (jobs) => removeStep(jobs, "omo-ai-payload-check", "Dry-run publish"),
  "skipped-arbitrary-step": (jobs) => setStep(jobs, "build", "Install dependencies", "skipped"),
  "neutral-step": (jobs) => setStep(jobs, "typecheck", "Dead-code check (knip)", "neutral"),
  "failed-job": (jobs) => {
    job(jobs, "lazycodex-published-smoke").conclusion = "failure"
  },
  "unmodeled-post": (jobs) => {
    const steps = job(jobs, "build").steps
    steps.splice(steps.length - 1, 0, done("Post Install dependencies"))
  },
  "truncated-listing": () => {},
  "duplicate-job": (jobs) => void jobs.push(job(jobs, "build")),
}

/** `gh api --paginate --slurp` output: required jobs need not all be on the first page. */
export function ciJobs(validation: Validation = "passed"): string {
  if (validation === "empty-response") return ""
  const jobs = passedJobs()
  MUTATIONS[validation](jobs)
  const total = jobs.length + (validation === "truncated-listing" ? 1 : 0)
  return JSON.stringify([
    { total_count: total, jobs: jobs.slice(0, 4) },
    { total_count: total, jobs: jobs.slice(4) },
  ])
}

export const CI_YML_PATH = fileURLToPath(CI_YML)

/** Stands in for `yq -o=json 'explode(.)' -` in bash stubs: Bun.YAML ($BUN_EXE) parses stdin like real yq on the runner. */
export const YQ_TO_JSON =
  `"$BUN_EXE" -e 'process.stdout.write(JSON.stringify(Bun.YAML.parse(require("fs").readFileSync(0, "utf8"))))'`
