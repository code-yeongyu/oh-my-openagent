import { execFileSync } from "node:child_process"

export type Validation = "passed" | "skipped-job" | "skipped-step" | "empty-response" | "missing-codex" | "skipped-senpi" | "skipped-macos-codex" | "skipped-macos-parity" | "skipped-windows-parity" | "skipped-unlisted" | "neutral-unlisted" | "allowed-skip"

const required: Record<string, string[]> = JSON.parse(
  execFileSync("bash", ["-c", "source .github/scripts/release-push-proof.sh && release_validation_contract"], {
    encoding: "utf8",
  }),
)

export function ciJobs(validation: Validation = "passed"): string {
  if (validation === "empty-response") return ""
  const jobs = Object.entries(required).filter(([name]) => !(validation === "missing-codex" && name === "codex-compatibility (ubuntu-latest, full)")).map(([name, steps]) => ({
    name,
    status: "completed",
    conclusion: (validation === "skipped-job" && name === "test-linux (remainder-2)") || (validation === "skipped-senpi" && name === "senpi-compatibility (windows-latest)") ? "skipped" : "success",
    steps: [...steps, "Write job summary"].map((step) => ({
      name: step,
      status: "completed",
      conclusion: (validation === "skipped-step" && step === "Type check") || (validation === "skipped-macos-codex" && step === "Run Codex platform smoke") || (validation === "skipped-macos-parity" && step === "Compare the binary with the npm launcher") || (validation === "skipped-windows-parity" && step === "Run the binary from an empty download folder twice") ? "skipped" : "success",
    })),
  }))

  if (validation === "skipped-unlisted" || validation === "neutral-unlisted") {
    const job = jobs.find((entry) => entry.name === "typecheck")
    if (!job) throw new Error("missing typecheck fixture")
    job.steps.push({ name: "A new CI check", status: "completed", conclusion: validation === "skipped-unlisted" ? "skipped" : "neutral" })
  }
  if (validation === "allowed-skip") {
    const job = jobs.find((entry) => entry.name === "test (windows-latest, 2/2)")
    if (!job) throw new Error("missing Windows shard 2 fixture")
    job.steps.push({ name: "Run actions/cache@v6", status: "completed", conclusion: "skipped" })
  }
  // gh api --paginate --slurp wraps each page; required jobs need not all be on the first page.
  return JSON.stringify([{ jobs: jobs.slice(0, 4) }, { jobs: jobs.slice(4) }])
}
