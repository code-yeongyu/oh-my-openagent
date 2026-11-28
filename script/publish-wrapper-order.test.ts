/// <reference types="bun-types" />

// Release contract: oh-my-openagent pins oh-my-opencode exactly, so a wrapper version npm serves before its payload
// fails every install with ETARGET. The wrapper may only be published after oh-my-opencode published and after
// npm serves it, from the checked-in wrapper directory, and the registry wait must cover the wrapper too.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

import { type Workflow, upstreamOf } from "./fixtures/publish-workflow-graph"

const workflow = load(readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")) as Workflow

type Step = NonNullable<Workflow["jobs"][string]["steps"]>[number] & { "working-directory"?: string }

const steps = (job: string): Step[] => [...(workflow.jobs[job]?.steps ?? [])]
const runs = (step: Step, command: string) => (step.run ?? "").includes(command)
const isWrapperPublish = (step: Step) =>
  runs(step, "npm publish") && step["working-directory"] === "packages/oh-my-openagent-wrapper"

describe("oh-my-openagent wrapper publish order", () => {
  test("#given publish.yml #when every npm publish is read #then only publish-wrapper publishes the wrapper", () => {
    const publishers = Object.keys(workflow.jobs).filter((job) => steps(job).some(isWrapperPublish))
    expect(publishers).toEqual(["publish-wrapper"])
    const renames = Object.keys(workflow.jobs).filter((job) =>
      steps(job).some((step) => runs(step, '.name = "oh-my-openagent"')),
    )
    expect(renames).toEqual([])
  })

  test("#given publish-wrapper #when its graph is read #then it waits for the job that publishes oh-my-opencode", () => {
    const payloadPublisher = Object.keys(workflow.jobs).find((job) =>
      steps(job).some((step) => step.name === "Publish oh-my-opencode"),
    )
    expect(payloadPublisher).toBe("publish-main")
    expect(upstreamOf(workflow, "publish-wrapper").has("publish-main")).toBe(true)
  })

  test("#given publish-wrapper #when its steps are read #then the payload wait and the shape check precede the publish", () => {
    const job = steps("publish-wrapper")
    const wait = job.findIndex((step) => runs(step, 'node script/wait-registry-versions.mjs "oh-my-opencode@$VERSION"'))
    const shape = job.findIndex((step) => runs(step, "node script/verify-openagent-wrapper.mjs"))
    const publish = job.findIndex(isWrapperPublish)
    expect(wait).toBeGreaterThan(-1)
    expect(shape).toBeGreaterThan(wait)
    expect(publish).toBeGreaterThan(shape)
    expect(job[publish]?.if).toBe(job[wait]?.if)
  })

  test("#given registry-wait #when its graph is read #then it reads the wrapper back after publish-wrapper", () => {
    expect(upstreamOf(workflow, "registry-wait").has("publish-wrapper")).toBe(true)
  })
})
