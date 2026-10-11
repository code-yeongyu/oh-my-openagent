import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

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
        inputs: z.object({ tag: z.object({ type: z.literal("string"), required: z.literal(true) }).passthrough() }),
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
  expect(job.if).toContain("!github.event.release.draft")
  expect(job.if).toContain("!github.event.release.prerelease")
  expect(job.if).toContain("github.event_name != 'release'")
  expect(job.if).toContain("github.event.release.author.login != 'github-actions[bot]'")
  const announce = job.steps.find((item) => item.name === "Announce release")
  expect(announce?.env?.DISCORD_OMO_RELEASES_WEBHOOK_URL).toBe("${{ secrets.DISCORD_OMO_RELEASES_WEBHOOK_URL }}")
  expect(announce?.env?.DRY_RUN).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}")
  expect(announce?.env?.PROBE).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.probe }}")
  expect(announce?.env?.ANNOUNCEMENT_EVENT).toBe("${{ github.event_name == 'release' && 'release' || 'workflow_dispatch' }}")
  expect(announce?.run).toBe("timeout -k 10 120 bun script/release-announce.ts")
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
    .find((item) => item.run?.includes('gh release create "v${VERSION}"') && !item.run.includes("--repo code-yeongyu/lazycodex"))
  expect(createRelease?.env?.GH_TOKEN).toBe("${{ secrets.GITHUB_TOKEN }}")
  expect(createRelease?.id).toBe("github-release")
  expect(publisher.jobs.release?.outputs?.created).toBe("${{ steps.github-release.outputs.created }}")
  const caller = publisher.jobs["release-announce"]
  expect(caller?.needs).toEqual(["release-metadata", "release"])
  expect(caller?.if).toBe("inputs.lazycodex_only != true && inputs.prepared_release_sha != '' && needs.release.outputs.created == 'true'")
  expect(caller?.uses).toBe("./.github/workflows/release-announce.yml")
  expect(caller?.with).toEqual({ tag: "v${{ needs.release-metadata.outputs.version }}" })
  expect(caller?.secrets).toEqual({ DISCORD_OMO_RELEASES_WEBHOOK_URL: "${{ secrets.DISCORD_OMO_RELEASES_WEBHOOK_URL }}" })
  expect(caller?.permissions).toEqual({ contents: "read" })
})

test.each([
  { view: 0, create: 0, status: 0, output: "created=false\n", calls: "" },
  { view: 1, create: 0, status: 0, output: "created=true\n", calls: "create\n" },
  { view: 1, create: 9, status: 9, output: "", calls: "create\n" },
])("#given release CLI results %p #when the actual workflow step runs #then created reflects successful creation only", ({ view, create, status, output, calls }) => {
  const publisher = z.object({ jobs: z.object({ release: z.object({
    steps: z.array(z.object({ id: z.string().optional(), run: z.string().optional() }).passthrough()),
  }).passthrough() }).passthrough() }).parse(Bun.YAML.parse(readFileSync(".github/workflows/publish.yml", "utf8")))
  const run = publisher.jobs.release.steps.find((step) => step.id === "github-release")?.run
  if (!run) throw new Error("Missing GitHub release creation step")
  const directory = mkdtempSync(join(tmpdir(), "omo-release-announce-"))
  const outputFile = join(directory, "output")
  const callsFile = join(directory, "calls")
  writeFileSync(outputFile, "")
  writeFileSync(callsFile, "")
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
        VERSION: "5.1.29",
        VIEW_STATUS: String(view),
        CREATE_STATUS: String(create),
        GITHUB_OUTPUT: outputFile,
        CALLS_FILE: callsFile,
      },
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(status)
    expect(readFileSync(outputFile, "utf8")).toBe(output)
    expect(readFileSync(callsFile, "utf8")).toBe(calls)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
