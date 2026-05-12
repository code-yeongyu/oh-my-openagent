import { describe, expect, test } from "bun:test"

describe("test script isolation", () => {
  test("#given mock.module tests in the suite #then bun run test uses the isolated CI runner", async () => {
    //#given
    const packageJson = await Bun.file("package.json").json()

    //#then
    expect(packageJson.scripts.test).toBe("bun run script/run-ci-tests.ts")
  })
})
