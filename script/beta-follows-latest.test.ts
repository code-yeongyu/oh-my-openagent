/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { betaMustFollowLatest, betaMustFollowLatestFromDistTags, compareVersions } from "./beta-follows-latest.mjs"

const cli = fileURLToPath(new URL("./beta-follows-latest.mjs", import.meta.url))

describe("betaMustFollowLatest", () => {
  test.each([
    { name: "a stable release newer than the beta prerelease moves beta", stable: "5.2.0", beta: "5.2.0-0.beta.9", move: true },
    { name: "the real case: 5.1.66 moves a beta stuck on 5.1.0", stable: "5.1.66", beta: "5.1.0", move: true },
    { name: "a stable release newer than an older stable beta moves beta", stable: "5.1.66", beta: "5.1.65", move: true },
    { name: "a beta prerelease of a higher version is kept", stable: "5.1.66", beta: "5.2.0-0.beta.1", move: false },
    { name: "a beta already on the stable version is a no-op", stable: "5.1.66", beta: "5.1.66", move: false },
    { name: "a beta on a newer stable version is kept", stable: "5.1.60", beta: "5.1.66", move: false },
    { name: "a missing beta moves", stable: "5.1.66", beta: "", move: true },
    { name: "an unset beta moves", stable: "5.1.66", beta: undefined, move: true },
    { name: "an invalid beta moves", stable: "5.1.66", beta: "not-a-version", move: true },
    { name: "surrounding whitespace from npm view is ignored", stable: "5.1.66", beta: "5.1.66\n", move: false },
  ])("$name", ({ stable, beta, move }) => {
    expect(betaMustFollowLatest(stable, beta)).toBe(move)
  })

  test.each(["5.1.66-0.beta.1", "v5.1.66", "", "5.1"])("refuses %p as the stable version", (stable) => {
    expect(() => betaMustFollowLatest(stable, "5.1.0")).toThrow("Not a stable version")
  })
})

describe("betaMustFollowLatestFromDistTags", () => {
  test.each([
    { name: "a lookup with no beta tag moves", tags: '{"latest":"5.1.66"}', move: true },
    { name: "a lookup with an older beta moves", tags: '{"latest":"5.1.66","beta":"5.1.0"}', move: true },
    { name: "a lookup with a newer beta prerelease is kept", tags: '{"latest":"5.1.66","beta":"5.2.0-0.beta.1"}', move: false },
    { name: "a lookup with beta on the stable version is a no-op", tags: '{"latest":"5.1.66","beta":"5.1.66"}', move: false },
  ])("$name", ({ tags, move }) => {
    expect(betaMustFollowLatestFromDistTags("5.1.66", tags)).toBe(move)
  })

  test.each([
    { name: "empty output from a failed npm view", tags: "" },
    { name: "no output at all", tags: undefined },
    { name: "output that is not JSON", tags: "npm ERR! network timeout" },
    { name: "an npm error object", tags: '{"error":{"code":"ETIMEDOUT","summary":"network"}}' },
    { name: "an object without latest", tags: '{"beta":"5.1.0"}' },
    { name: "a JSON array", tags: '["5.1.0"]' },
  ])("a failed lookup is not a missing beta: $name", ({ tags }) => {
    expect(betaMustFollowLatestFromDistTags("5.1.66", tags)).toBeNull()
  })

  test("refuses a prerelease stable version even when the lookup failed", () => {
    expect(() => betaMustFollowLatestFromDistTags("5.2.0-0.beta.1", "")).toThrow("Not a stable version")
  })
})

describe("compareVersions", () => {
  test.each([
    ["5.1.0-0.beta.1", "5.1.0", -1],
    ["5.1.1-0.beta.1", "5.1.0", 1],
    ["5.1.0-0.beta.2", "5.1.0-0.beta.10", -1],
    ["5.1.0-0.beta", "5.1.0-0.beta.1", -1],
    ["5.1.0-0.1", "5.1.0-0.beta", -1],
    ["5.1.0-0.rc.1", "5.1.0-0.beta.9", 1],
    ["10.0.0", "9.99.99", 1],
    ["5.1.66+build.1", "5.1.66", 0],
  ] as const)("%s vs %s -> %d", (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected)
    expect(compareVersions(right, left)).toBe(expected === 0 ? 0 : -expected)
  })
})

describe("beta-follows-latest CLI", () => {
  test.each([
    { args: ["5.1.66", "5.1.0"], stdout: "move=true\n" },
    { args: ["5.1.66", ""], stdout: "move=true\n" },
    { args: ["5.1.66", "5.2.0-0.beta.1"], stdout: "move=false\n" },
    { args: ["--dist-tags", "5.1.66", '{"latest":"5.1.66"}'], stdout: "move=true\n" },
    { args: ["--dist-tags", "5.1.66", '{"latest":"5.1.66","beta":"5.2.0-0.beta.1"}'], stdout: "move=false\n" },
    { args: ["--dist-tags", "5.1.66", ""], stdout: "lookup=failed\n" },
  ])("prints $stdout for $args", ({ args, stdout }) => {
    const result = spawnSync("node", [cli, ...args], { encoding: "utf8", timeout: 10_000 })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(stdout)
  })

  test("fails with a workflow error on a prerelease stable argument", () => {
    const result = spawnSync("node", [cli, "5.2.0-0.beta.1", "5.1.0"], { encoding: "utf8", timeout: 10_000 })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("::error::Not a stable version: 5.2.0-0.beta.1")
  })
})
