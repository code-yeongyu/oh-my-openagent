/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("test workflows", () => {
  test("#given CI workflow #when tests run #then plain bun test is guarded by completion summary", () => {
    // given
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")

    // then
    expect(workflow).toMatch(/bun test/)
    expect(workflow).not.toContain("run-ci-tests")
    expect(workflow).toContain("assert-test-summary")
    expect(workflow).toContain("bun test src/shared/dist-bundle-bun-globals.test.ts")
  })

  test("#given publish workflow #when tests run #then plain bun test is guarded by completion summary", () => {
    // given
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")

    // then
    expect(workflow).toMatch(/bun test/)
    expect(workflow).not.toContain("run-ci-tests")
    expect(workflow).toContain("assert-test-summary")
  })
})
