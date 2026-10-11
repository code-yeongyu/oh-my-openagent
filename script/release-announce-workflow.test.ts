import { expect, test } from "bun:test"
import { z } from "zod"

test("#given release automation #when parsed #then published events, safe dispatch defaults, and publisher provenance are wired", async () => {
  const step = z.object({
    name: z.string().optional(),
    run: z.string().optional(),
    env: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()
  const workflow = z.object({
    on: z.object({
      release: z.object({ types: z.array(z.string()) }),
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
  const announce = job.steps.find((item) => item.name === "Announce release")
  expect(announce?.env?.DISCORD_OMO_RELEASES_WEBHOOK_URL).toBe("${{ secrets.DISCORD_OMO_RELEASES_WEBHOOK_URL }}")
  expect(announce?.env?.DRY_RUN).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}")
  expect(announce?.env?.PROBE).toBe("${{ github.event_name == 'workflow_dispatch' && inputs.probe }}")
  expect(announce?.run).toBe("timeout -k 10 120 bun script/release-announce.ts")
  const publisher = z.object({ jobs: z.record(z.string(), z.object({
    steps: z.array(step).optional(),
  }).passthrough()) }).parse(Bun.YAML.parse(await Bun.file(".github/workflows/publish.yml").text()))
  const createRelease = Object.values(publisher.jobs).flatMap((job) => job.steps ?? [])
    .find((item) => item.run?.includes('gh release create "v${VERSION}"') && !item.run.includes("--repo code-yeongyu/lazycodex"))
  expect(createRelease?.env?.GH_TOKEN).toBe("${{ secrets.GH_PAT }}")
})
