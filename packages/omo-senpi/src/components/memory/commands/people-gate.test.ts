import { describe, expect, test } from "bun:test"

import { MemoryFakeExtensionAPI, memorySettings } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke } from "./commands.test-support"
import { peopleFixture } from "./people.test-support"
import { registerMemoryCommands } from "./register"

describe("people command people.enabled gate", () => {
  test("#given people.enabled false #when /people runs #then it refuses without reading any record", async () => {
    // given
    const identity = await peopleFixture()
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommands(
      pi,
      fakeDeps(identity, {
        loadSettings: () => ({
          settings: memorySettings({ people: { enabled: false, max_entries: 40, max_entry_chars: 200 } }),
        }),
      }),
    )
    const ctx = fakeCommandContext()

    // when
    const text = await invoke(pi, "people", "", ctx)

    // then
    expect(ctx.ui.notifications).toEqual([{ message: text, level: "error" }])
  }, 30_000)

  test("#given people.enabled true #when the suite registers #then /people is present", async () => {
    // given
    const identity = await peopleFixture()
    const pi = new MemoryFakeExtensionAPI()

    // when
    registerMemoryCommands(pi, fakeDeps(identity))

    // then
    expect(pi.commands.map((command) => command.name)).toContain("people")
  }, 30_000)
})
