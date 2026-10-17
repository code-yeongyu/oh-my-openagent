/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { load } from "js-yaml"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("workflow field must be an object")
  }
  return value
}

function workflow(name: string): Record<string, unknown> {
  return record(load(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8")))
}

// GitHub Actions trigger and concurrency contracts protect required check runs.
describe("#given required CI and an optional full-matrix label run", () => {
  test("#then label runs are limited to the normal CI target branches", () => {
    // given / when
    const triggers = record(workflow("ci-full-matrix-label.yml")["on"])
    const pullRequest = record(triggers["pull_request"])

    // then
    expect(Object.keys(triggers)).toEqual(["pull_request"])
    expect(pullRequest["types"]).toEqual(["labeled"])
    expect(pullRequest["branches"]).toEqual(["dev", "master"])
  })

  test("#then the called workflow cannot share normal CI's workflow identity", () => {
    // given / when
    const ci = workflow("ci.yml")
    const caller = workflow("ci-full-matrix-label.yml")

    // then
    expect(typeof caller["name"]).toBe("string")
    expect(caller["name"]).not.toBe("CI")
    expect(caller["name"]).not.toBe(ci["name"])
  })

  test("#then unrelated labels cannot enter the full-matrix job's concurrency group", () => {
    // given / when
    const caller = workflow("ci-full-matrix-label.yml")
    const job = record(record(caller["jobs"])["full-matrix"])

    // then: GitHub evaluates the job gate before job-level concurrency.
    expect(caller["concurrency"]).toBeUndefined()
    expect(job["if"]).toBe("github.event.label.name == 'ci:full-matrix'")
    expect(job["uses"]).toBe("./.github/workflows/ci.yml")
    const concurrency = record(job["concurrency"])
    expect(concurrency["cancel-in-progress"]).toBe(true)
    expect(typeof concurrency["group"]).toBe("string")
    expect(String(concurrency["group"])).toContain("github.workflow")
    expect(String(concurrency["group"])).toContain("github.event.pull_request.number")
    expect(String(concurrency["group"])).not.toContain("github.ref")
  })
})
