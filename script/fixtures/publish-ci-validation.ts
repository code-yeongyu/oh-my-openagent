export type Validation = "passed" | "skipped-job" | "skipped-step" | "empty-response"

export function ciJobs(validation: Validation = "passed"): string {
  if (validation === "empty-response") return ""
  const jobs = [
    ["typecheck", "Type check", "Lint", "Lint ratchet", "Dead-code check (knip)"],
    ["test-linux (omo-opencode)", "Run vendored lsp-daemon tests", "Run omo-opencode tests", "Run the serial quarantine"],
    ["test-linux (memory-core)", "Run memory-core tests in a PID namespace"],
    ["test-linux (remainder-1)", "Run the first remainder half"],
    ["test-linux (remainder-2)", "Run the second remainder half"],
    ["test (windows-latest, 1/2)", "Run vendored lsp-daemon tests", "Run tests with Windows telemetry"],
    ["test (windows-latest, 2/2)", "Run tests"],
    [
      "macos-combined",
      "Run vendored lsp-daemon tests",
      "Run root test shard 1",
      "Run root test shard 2 heavy",
      "Run root test shard 2 light",
    ],
  ].map(([name, ...steps]) => ({
    name,
    status: "completed",
    conclusion: validation === "skipped-job" && name === "test-linux (remainder-2)" ? "skipped" : "success",
    steps: [...steps, "Write job summary"].map((step) => ({
      name: step,
      status: "completed",
      conclusion: validation === "skipped-step" && step === "Type check" ? "skipped" : "success",
    })),
  }))

  // gh api --paginate --slurp wraps each page; required jobs need not all be on the first page.
  return JSON.stringify([{ jobs: jobs.slice(0, 4) }, { jobs: jobs.slice(4) }])
}
