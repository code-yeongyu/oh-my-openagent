import { describe, expect, it } from "bun:test"
import { runTestFast, testFastGroups, type TestFastGroup } from "./test-fast"

describe("runTestFast", () => {
  it("#given three fixed test groups #when the runner starts #then every group is launched before any exit is released", async () => {
    // given
    const order: string[] = []
    const spawnGroup = async (group: TestFastGroup) => {
      order.push(`start:${group.name}`)
      await Promise.resolve()
      order.push(`exit:${group.name}`)
      return 0
    }

    // when
    const exit = await runTestFast(spawnGroup)

    // then
    expect(testFastGroups().length).toBe(3)
    expect(order.indexOf("start:senpi")).toBeLessThan(
      order.indexOf("exit:opencode-memory"),
    )
    expect(exit).toBe(0)
  })

  it("#given one nonzero group exit #when the runner aggregates #then the combined exit is 1", async () => {
    // given
    const spawnGroup = async (group: TestFastGroup) =>
      group.name === "root-rest" ? 3 : 0

    // when
    const exit = await runTestFast(spawnGroup)

    // then
    expect(exit).toBe(1)
  })
})
