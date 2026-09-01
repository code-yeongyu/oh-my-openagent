/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
// Windows checks YAML out with CRLF; normalize once so step lookups stay platform-independent.
const workflowText = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n")

interface Step {
  name?: string
  if?: string
}

interface Job {
  needs?: string[] | string
  if?: string
  steps?: Step[]
}

interface Workflow {
  jobs?: Record<string, Job>
}

const workflow = Bun.YAML.parse(workflowText) as Workflow

const POST_PUBLISH_STEPS = [
  "Wait for omo-ai registry readiness",
  "Guard omo-ai dist-tags",
  "Verify omo-ai live install",
  "Smoke test published lazycodex-ai",
]

function job(name: string): Job {
  const found = workflow.jobs?.[name]
  expect(found, `publish.yml must define the ${name} job`).toBeDefined()
  return found as Job
}

function stepNames(name: string): string[] {
  return (job(name).steps ?? []).map((step) => step.name ?? "")
}

function needsOf(name: string): string[] {
  const needs = job(name).needs ?? []
  return Array.isArray(needs) ? needs : [needs]
}

describe("publish post-publish verification", () => {
  describe("#given registry propagation must not hold the release hostage", () => {
    test("#when publish-main is inspected #then it no longer carries the post-publish verification steps", () => {
      const names = stepNames("publish-main")
      expect(
        POST_PUBLISH_STEPS.filter((step) => names.includes(step)),
        "post-publish verification must not sit between npm publish and the release job",
      ).toEqual([])
    })

    test("#when the workflow is parsed #then post-publish-verify owns every one of those steps", () => {
      const names = stepNames("post-publish-verify")
      expect(POST_PUBLISH_STEPS.filter((step) => !names.includes(step))).toEqual([])
    })

    test("#when post-publish-verify is wired #then it runs after the release job", () => {
      expect(needsOf("post-publish-verify")).toContain("release")
    })

    test("#when the release job is wired #then it never waits on post-publish-verify", () => {
      expect(needsOf("release")).not.toContain("post-publish-verify")
    })

    test("#when post-publish-verify completes #then it writes a job summary like every other publish job", () => {
      expect(stepNames("post-publish-verify")).toContain("Write job summary")
    })
  })

  describe("#given pre-publish gating must stay intact", () => {
    test("#when publish-main is inspected #then it still refuses to publish without platform packages", () => {
      expect(stepNames("publish-main")).toContain("Verify platform packages are published")
    })
  })
})
