import { execFileSync } from "node:child_process"

export type Validation = "passed" | "skipped-job" | "skipped-step" | "empty-response" | "missing-codex" | "skipped-senpi" | "skipped-macos-codex"

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
      conclusion: (validation === "skipped-step" && step === "Type check") || (validation === "skipped-macos-codex" && step === "Run Codex platform smoke") ? "skipped" : "success",
    })),
  }))

  // gh api --paginate --slurp wraps each page; required jobs need not all be on the first page.
  return JSON.stringify([{ jobs: jobs.slice(0, 4) }, { jobs: jobs.slice(4) }])
}
