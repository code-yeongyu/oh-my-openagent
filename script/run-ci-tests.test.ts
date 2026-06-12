import { describe, expect, test } from "bun:test"
import { selectCiTestTargets } from "./run-ci-tests"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getRootOptionalDependencies(manifest: unknown): Record<string, string> {
  if (!isRecord(manifest) || !isRecord(manifest.optionalDependencies)) {
    return {}
  }

  const optionalDependencies: Record<string, string> = {}
  for (const [name, version] of Object.entries(manifest.optionalDependencies)) {
    if (typeof version === "string") {
      optionalDependencies[name] = version
    }
  }

  return optionalDependencies
}

describe("plain test script policy", () => {
  test("#given global mock tests in the suite #then bun run test remains the package test script", async () => {
    //#given
    const packageJson = await Bun.file("package.json").json()

    //#then
    expect(packageJson.scripts.test).toBe("bun test")
  })

  test("#given CI root tests #then GitHub Actions uses the plain Bun test gate", async () => {
    // given
    const workflow = await Bun.file(".github/workflows/ci.yml").text()

    // then
    expect(workflow).toMatch(/- name: Run tests\s+run: bun test/)
    expect(workflow).not.toContain("run: bun test --max-concurrency")
  })

  test("#given the vendored lsp-daemon suite excluded from bun test #then CI runs it as its own gate", async () => {
    // given
    const workflow = await Bun.file(".github/workflows/ci.yml").text()

    // then
    expect(workflow).toMatch(
      /- name: Run vendored lsp-daemon tests\s+run: npm test\s+working-directory: packages\/lsp-daemon/,
    )
  })

  test("#given platform optional dependency versions #when CI runs frozen install #then bun lock stays in sync", async () => {
    // given
    const packageJson: unknown = await Bun.file("package.json").json()
    const lockfile = await Bun.file("bun.lock").text()
    const platformDependencies = Object.entries(getRootOptionalDependencies(packageJson)).filter(([name]) =>
      name.startsWith("oh-my-opencode-")
    )

    // then
    expect(platformDependencies.length).toBeGreaterThan(0)
    for (const [name, version] of platformDependencies) {
      expect(lockfile).toContain(`"${name}": "${version}"`)
      expect(lockfile).toContain(`"${name}": ["${name}@${version}"`)
    }
  })

  test("#given isolated test shards #when selecting targets #then shards are deterministic and complete", () => {
    // given
    const ciTestPlan = {
      isolatedModuleMockFiles: [],
      isolatedTestTargets: ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts", "e.test.ts"],
      sharedTestFiles: ["shared.test.ts"],
    }

    // when
    const shardOne = selectCiTestTargets(ciTestPlan, { phase: "isolated", shardCount: 2, shardIndex: 0 })
    const shardTwo = selectCiTestTargets(ciTestPlan, { phase: "isolated", shardCount: 2, shardIndex: 1 })

    // then
    expect(shardOne).toEqual({ isolatedTestTargets: ["a.test.ts", "c.test.ts", "e.test.ts"], sharedTestFiles: [] })
    expect(shardTwo).toEqual({ isolatedTestTargets: ["b.test.ts", "d.test.ts"], sharedTestFiles: [] })
    expect([...shardOne.isolatedTestTargets, ...shardTwo.isolatedTestTargets].sort()).toEqual(ciTestPlan.isolatedTestTargets)
  })

  test("#given shared phase #when selecting targets #then only shared tests run", () => {
    // given
    const ciTestPlan = {
      isolatedModuleMockFiles: [],
      isolatedTestTargets: ["isolated.test.ts"],
      sharedTestFiles: ["shared.test.ts"],
    }

    // when
    const selectedTargets = selectCiTestTargets(ciTestPlan, { phase: "shared", shardCount: 1, shardIndex: 0 })

    // then
    expect(selectedTargets).toEqual({ isolatedTestTargets: [], sharedTestFiles: ["shared.test.ts"] })
  })
})
