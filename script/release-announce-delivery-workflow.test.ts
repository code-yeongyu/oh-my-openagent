import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { evaluateExpression } from "./release-announce-workflow-test-support"

const failures = [
  { failure: "missing secret", reason: "DISCORD_OMO_RELEASES_WEBHOOK_URL is missing" },
  { failure: "failed post", reason: "Discord POST returned HTTP 500" },
  { failure: "uncertain post", reason: "Discord POST did not return a created message" },
]
test.each(failures.flatMap((failure) => [true, false].map((automatic) => ({ ...failure, automatic }))))(
  "#given $failure and automatic=$automatic #when the real CLI fails #then automatic errors are tolerated and warn while manual errors stay strict",
  ({ automatic, failure, reason }) => {
    const workflow = z.object({ jobs: z.object({ announce: z.object({
      "continue-on-error": z.string(),
      steps: z.array(z.object({ name: z.string().optional(), if: z.string().optional(), run: z.string().optional() }).passthrough()),
    }).passthrough() }) }).parse(Bun.YAML.parse(readFileSync(".github/workflows/release-announce.yml", "utf8")))
    const job = workflow.jobs.announce
    const step = job.steps.find((item) => item.name === "Announce release")
    const warning = job.steps.find((item) => item.name === "Warn about undelivered announcement")
    if (!step?.run || !warning?.run || !warning.if) throw new Error("Missing announcement or recovery step")
    const directory = mkdtempSync(join(tmpdir(), "omo-announcement-failure-"))
    const summary = join(directory, "summary")
    const preload = join(directory, "transport.mjs")
    writeFileSync(summary, "")
    // Replace only fetch, the script's existing transport seam, never the CLI or announce().
    writeFileSync(preload, `
globalThis.fetch = async (url, init) => {
  if (init?.method === "GET" && String(url).startsWith("https://api.github.com/")) {
    return Response.json({ tag_name: "v5.1.29", body: "**Fixed.** Details.", draft: false, prerelease: false });
  }
  if (init?.method === "POST" && String(url).startsWith("https://discord.com/")) {
    console.log("TEST_POST_REACHED");
    return Response.json({}, { status: process.env.TEST_POST_FAILURE === "failed post" ? 500 : 200 });
  }
  throw new Error("Unexpected test request");
};
`)
    try {
      // The job runs on ubuntu-latest, which has GNU timeout; macOS test runners don't, so drop only that wrapper there.
      const hasTimeout = spawnSync("bash", ["-c", "command -v timeout"]).status === 0
      const command = hasTimeout ? step.run : step.run.replace(/^timeout -k \d+ \d+ /, "")
      const run = command.replace("bun script/", `bun --preload "${preload}" script/`)
      const delivery = spawnSync("bash", ["-c", run], {
        encoding: "utf8", timeout: 5000,
        env: { ...process.env, ANNOUNCEMENT_EVENT: automatic ? "workflow_call" : "workflow_dispatch",
          RELEASE_TAG: "v5.1.29", DISCORD_OMO_RELEASES_WEBHOOK_URL: failure === "missing secret" ? "" : "https://discord.com/api/webhooks/123/dummy",
          TEST_POST_FAILURE: failure, DRY_RUN: "false", PROBE: "false" },
      })
      expect(delivery.error).toBeUndefined()
      expect(delivery.status).toBe(1)
      expect(delivery.stderr).toContain(`::error::Release announcement v5.1.29: ${reason}`)
      expect(delivery.stdout.includes("TEST_POST_REACHED")).toBe(failure !== "missing secret")
      const context = { inputs: { automatic } }
      expect(evaluateExpression(job["continue-on-error"], context)).toBe(automatic)
      const shouldWarn = evaluateExpression(warning.if, context, ["failure"])
      expect(shouldWarn).toBe(automatic)
      expect(evaluateExpression(warning.if, context, ["cancelled"])).toBe(automatic)
      if (shouldWarn) {
        const recovery = spawnSync("bash", ["-c", warning.run], {
          encoding: "utf8", timeout: 5000,
          env: { ...process.env, RELEASE_TAG: "v5.1.29", GITHUB_STEP_SUMMARY: summary },
        })
        expect(recovery.status).toBe(0)
        const command = "gh workflow run release-announce.yml -f tag=v5.1.29 -f dry_run=false"
        expect(recovery.stdout).toContain("::warning::")
        expect(recovery.stdout).toContain(command)
        expect(readFileSync(summary, "utf8")).toContain(command)
      } else expect(readFileSync(summary, "utf8")).toBe("")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test.each([{ dry_run: true, probe: false }, { dry_run: false, probe: true }])(
  "#given manual mode %p #when it fails #then no production recovery hint is eligible",
  (inputs) => {
    const workflow = z.object({ jobs: z.object({ announce: z.object({
      steps: z.array(z.object({ name: z.string().optional(), if: z.string().optional() }).passthrough()),
    }).passthrough() }) }).parse(Bun.YAML.parse(readFileSync(".github/workflows/release-announce.yml", "utf8")))
    const warning = workflow.jobs.announce.steps.find((step) => step.name === "Warn about undelivered announcement")
    expect(evaluateExpression(z.string().parse(warning?.if), { inputs }, ["failure"])).toBe(false)
  },
)

test("#given skipped or cancelled automatic announcement #when recovery runs #then the summary writer warns and names the command", () => {
  const workflow = z.object({ jobs: z.object({ "release-announce-recovery": z.object({
    steps: z.array(z.object({ name: z.string(), run: z.string() }).passthrough()),
  }).passthrough() }) }).parse(Bun.YAML.parse(readFileSync(".github/workflows/publish.yml", "utf8")))
  const step = workflow.jobs["release-announce-recovery"].steps.find((item) => item.name === "Write job summary")
  if (!step) throw new Error("Missing recovery summary writer")
  const directory = mkdtempSync(join(tmpdir(), "omo-announcement-recovery-"))
  const summary = join(directory, "summary")
  writeFileSync(summary, "")
  try {
    const result = spawnSync("bash", ["-c", step.run], {
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, RELEASE_TAG: "v5.1.29", GITHUB_STEP_SUMMARY: summary },
    })
    expect(result.status).toBe(0)
    const command = "gh workflow run release-announce.yml -f tag=v5.1.29 -f dry_run=false"
    expect(result.stdout).toContain("::warning::")
    expect(result.stdout).toContain(command)
    expect(readFileSync(summary, "utf8")).toContain(command)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
