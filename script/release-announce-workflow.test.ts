import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

// Evaluate the expression subset used by these repository-owned workflows.
function evaluateExpression(expression: string, context: Readonly<Record<string, unknown>>, statuses: readonly string[] = ["success"]): unknown {
  const code = expression.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, "")
    .replace(/\b(?:inputs|needs|steps|github|secrets)(?:\.[\w-]+)+/g, (path) =>
      `context${path.split(".").map((key) => `[${JSON.stringify(key)}]`).join("")}`)
  const result: unknown = new Function("context", "always", "success", "failure", "cancelled", `return (${code})`)(
    context, () => true, () => statuses.every((status) => status === "success"),
    () => statuses.includes("failure"), () => statuses.includes("cancelled"),
  )
  return result
}

test("#given release automation #when parsed #then published events, safe dispatch defaults, and publisher provenance are wired", async () => {
  const step = z.object({
    name: z.string().optional(),
    id: z.string().optional(),
    run: z.string().optional(),
    env: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()
  const workflow = z.object({
    on: z.object({
      release: z.object({ types: z.array(z.string()) }),
      workflow_call: z.object({
        inputs: z.object({
          tag: z.object({ type: z.literal("string"), required: z.literal(true) }).passthrough(),
          automatic: z.object({ type: z.literal("boolean"), default: z.literal(true) }).passthrough(),
        }),
        secrets: z.object({ DISCORD_OMO_RELEASES_WEBHOOK_URL: z.object({ required: z.literal(true) }) }),
      }),
      workflow_dispatch: z.object({ inputs: z.record(z.string(), z.object({
        type: z.string(), required: z.boolean().optional(), default: z.boolean().optional(),
      }).passthrough()) }),
    }),
    permissions: z.object({ contents: z.literal("read") }),
    jobs: z.object({ announce: z.object({
      if: z.string(),
      "timeout-minutes": z.number(),
      steps: z.array(step),
    }) }),
  }).parse(Bun.YAML.parse(await Bun.file(".github/workflows/release-announce.yml").text()))
  expect(workflow.on.release.types).toEqual(["published"])
  const inputs = workflow.on.workflow_dispatch.inputs
  expect(inputs.tag).toMatchObject({ type: "string", required: true })
  expect(inputs.dry_run).toMatchObject({ type: "boolean", default: true })
  expect(inputs.probe).toMatchObject({ type: "boolean", default: false })
  const job = workflow.jobs.announce
  for (const [draft, prerelease, login, expected] of [
    [false, false, "maintainer", true], [true, false, "maintainer", false],
    [false, true, "maintainer", false], [false, false, "github-actions[bot]", false],
  ] as const) {
    expect(evaluateExpression(job.if, { github: { event_name: "release", event: { release: { draft, prerelease, author: { login } } } } })).toBe(expected)
  }
  const announce = job.steps.find((item) => item.name === "Announce release")
  expect(evaluateExpression(z.string().parse(announce?.env?.DISCORD_OMO_RELEASES_WEBHOOK_URL),
    { secrets: { DISCORD_OMO_RELEASES_WEBHOOK_URL: "announcement-token" } })).toBe("announcement-token")
  for (const [event_name, automatic, expected, manual] of [
    ["workflow_dispatch", true, "workflow_call", false],
    ["workflow_dispatch", false, "workflow_dispatch", true],
    ["release", false, "release", false],
  ] as const) {
    const context = { github: { event_name }, inputs: automatic ? { automatic } : { dry_run: true, probe: true } }
    expect(evaluateExpression(z.string().parse(announce?.env?.ANNOUNCEMENT_EVENT), context)).toBe(expected)
    expect(Boolean(evaluateExpression(z.string().parse(announce?.env?.DRY_RUN), context))).toBe(manual)
    expect(Boolean(evaluateExpression(z.string().parse(announce?.env?.PROBE), context))).toBe(manual)
  }
  expect(announce?.run).toMatch(/\btimeout\s+-k\s+\d+\s+\d+\s+bun\s+script\/release-announce\.ts\b/)
  const publisher = z.object({ jobs: z.record(z.string(), z.object({
    steps: z.array(step).optional(),
    needs: z.array(z.string()).optional(),
    if: z.string().optional(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
    secrets: z.union([z.literal("inherit"), z.record(z.string(), z.string())]).optional(),
    permissions: z.object({ contents: z.string() }).optional(),
    outputs: z.record(z.string(), z.string()).optional(),
  }).passthrough()) }).parse(Bun.YAML.parse(await Bun.file(".github/workflows/publish.yml").text()))
  const createRelease = Object.values(publisher.jobs).flatMap((job) => job.steps ?? [])
    .find((item) => item.run && /gh\s+release\s+create\b/.test(item.run) && !item.run.includes("--repo code-yeongyu/lazycodex"))
  expect(evaluateExpression(z.string().parse(createRelease?.env?.GH_TOKEN), { secrets: { GITHUB_TOKEN: "publisher-token" } })).toBe("publisher-token")
  for (const dist_tag of ["", "beta"]) {
    expect(evaluateExpression(z.string().parse(createRelease?.env?.DIST_TAG),
      { needs: { "release-metadata": { outputs: { dist_tag } } } })).toBe(dist_tag)
  }
  const createId = z.string().parse(createRelease?.id)
  for (const created of ["true", "false"]) {
    expect(evaluateExpression(z.string().parse(publisher.jobs.release?.outputs?.created),
      { steps: { [createId]: { outputs: { created } } } })).toBe(created)
  }
  const caller = publisher.jobs["release-announce"]
  expect(new Set(caller?.needs)).toEqual(new Set(["release-metadata", "release", "installer-mirror"]))
  const versionStep = publisher.jobs["release-metadata"]?.steps?.find((item) => item.run?.includes("script/release-version.mjs"))
  const versionId = z.string().parse(versionStep?.id)
  for (const dist_tag of ["", "beta"]) {
    expect(evaluateExpression(z.string().parse(publisher.jobs["release-metadata"]?.outputs?.dist_tag),
      { steps: { [versionId]: { outputs: { dist_tag } } } })).toBe(dist_tag)
  }
  expect(caller?.uses).toBe("./.github/workflows/release-announce.yml")
  const tag = z.string().parse(caller?.with?.tag).replace(/\$\{\{(.+?)\}\}/g, (_match, expression: string) =>
    String(evaluateExpression(expression, { needs: { "release-metadata": { outputs: { version: "5.1.29" } } } })))
  expect(tag).toBe("v5.1.29")
  const secrets = z.record(z.string(), z.string()).parse(caller?.secrets)
  expect(Object.keys(secrets)).toEqual(["DISCORD_OMO_RELEASES_WEBHOOK_URL"])
  expect(evaluateExpression(z.string().parse(secrets.DISCORD_OMO_RELEASES_WEBHOOK_URL),
    { secrets: { DISCORD_OMO_RELEASES_WEBHOOK_URL: "announcement-token" } })).toBe("announcement-token")
  expect(caller?.permissions).toEqual({ contents: "read" })
})

const published = {
  created: "true", distTag: "", release: "success", mirror: "success", platform: "success",
  skipPlatform: false, lazycodexOnly: false, prepared: "prepared-sha", expected: true,
}
test.each([
  { ...published, name: "fresh stable" },
  { ...published, name: "later release failure", release: "failure" },
  { ...published, name: "failed before creation", release: "failure", created: "", mirror: "skipped", expected: false },
  { ...published, name: "cancelled after creation", release: "cancelled", mirror: "skipped" },
  { ...published, name: "skipped platform", platform: "skipped", mirror: "skipped", skipPlatform: true },
  { ...published, name: "failed mirror", mirror: "failure" },
  { ...published, name: "already existed", created: "false", expected: false },
  { ...published, name: "beta", distTag: "beta", expected: false },
  { ...published, name: "LazyCodex only", lazycodexOnly: true, expected: false },
  { ...published, name: "preparation", prepared: "", expected: false },
])("#given $name #when Actions evaluates the caller #then announcement eligibility follows creation", async (scenario) => {
  const workflow = z.object({ jobs: z.object({ "release-announce": z.object({ if: z.string() }) }) })
    .parse(Bun.YAML.parse(await Bun.file(".github/workflows/publish.yml").text()))
  const expression = workflow.jobs["release-announce"].if
  // Actions implicitly prepends success() unless a status-check function exists.
  const condition = /\b(?:always|success|failure|cancelled)\s*\(/.test(expression) ? expression : `success() && (${expression})`
  expect(Boolean(evaluateExpression(condition, {
    inputs: { lazycodex_only: scenario.lazycodexOnly, prepared_release_sha: scenario.prepared, skip_platform: scenario.skipPlatform },
    needs: {
      release: { result: scenario.release, outputs: { created: scenario.created } },
      "release-metadata": { result: "success", outputs: { dist_tag: scenario.distTag } },
      "installer-mirror": { result: scenario.mirror },
      "publish-platform": { result: scenario.platform },
    },
  }, [scenario.release, scenario.mirror, scenario.platform]))).toBe(scenario.expected)
})

test.each([
  { version: "5.1.29", distTag: "", view: 0, create: 0, status: 0, output: "created=false\n", calls: "", warning: true },
  { version: "5.1.29-beta.1", distTag: "beta", view: 0, create: 0, status: 0, output: "created=false\n", calls: "", warning: false },
  { version: "5.1.29", distTag: "", view: 1, create: 0, status: 0, output: "created=true\n", calls: "create\n", warning: false },
  { version: "5.1.29", distTag: "", view: 1, create: 9, status: 9, output: "", calls: "create\n", warning: false },
])("#given release CLI results %p #when the actual workflow step runs #then creation and recovery are observable", ({ version, distTag, view, create, status, output, calls, warning }) => {
  const publisher = z.object({ jobs: z.object({ release: z.object({
    steps: z.array(z.object({ id: z.string().optional(), run: z.string().optional() }).passthrough()),
  }).passthrough() }).passthrough() }).parse(Bun.YAML.parse(readFileSync(".github/workflows/publish.yml", "utf8")))
  const run = publisher.jobs.release.steps.find((step) => step.id === "github-release")?.run
  if (!run) throw new Error("Missing GitHub release creation step")
  const directory = mkdtempSync(join(tmpdir(), "omo-release-announce-"))
  const outputFile = join(directory, "output")
  const callsFile = join(directory, "calls")
  const summaryFile = join(directory, "summary")
  writeFileSync(outputFile, "")
  writeFileSync(callsFile, "")
  writeFileSync(summaryFile, "")
  const commands = `
gh() {
  case "$1 $2" in
    "release list") printf 'v5.1.28\\n' ;;
    "release view") return "$VIEW_STATUS" ;;
    "release create") printf 'create\\n' >> "$CALLS_FILE"; return "$CREATE_STATUS" ;;
    *) return 99 ;;
  esac
}
bun() { printf '%s' '--latest'; }
`
  try {
    const result = spawnSync("bash", ["-c", commands + run], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        VERSION: version,
        DIST_TAG: distTag,
        VIEW_STATUS: String(view),
        CREATE_STATUS: String(create),
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        CALLS_FILE: callsFile,
      },
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(status)
    expect(readFileSync(outputFile, "utf8")).toBe(output)
    expect(readFileSync(callsFile, "utf8")).toBe(calls)
    expect(result.stdout.includes("::warning::")).toBe(warning)
    const summary = readFileSync(summaryFile, "utf8")
    if (warning) {
      const recovery = `gh workflow run release-announce.yml -f tag=v${version} -f dry_run=false`
      expect(result.stdout).toContain(recovery)
      expect(summary).toContain(recovery)
    } else expect(summary).toBe("")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
