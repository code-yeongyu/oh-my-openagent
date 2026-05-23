import { describe, expect, test } from "bun:test"
import { selectCiTestTargets } from "./run-ci-tests"

describe("plain test script policy", () => {
  test("#given mock.module tests in the suite #then bun run test remains the package test script", async () => {
    //#given
    const packageJson = await Bun.file("package.json").json()

    //#then
    expect(packageJson.scripts.test).toBe("bun test")
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
