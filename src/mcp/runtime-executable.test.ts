import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { resolveRuntimeExecutable } from "./runtime-executable"

describe("resolveRuntimeExecutable", () => {
  test("#given lookup returns an absolute command #when resolving #then marks the executable available", () => {
    // given
    const nodePath = join("/tmp", "omo-runtime", "node")

    // when
    const result = resolveRuntimeExecutable("node", {
      which: (commandName) => (commandName === "node" ? nodePath : null),
    })

    // then
    expect(result).toEqual({ command: nodePath, available: true })
  })

  test("#given lookup misses #when resolving #then keeps the command unavailable", () => {
    // given
    const commandName = "definitely-not-installed"

    // when
    const result = resolveRuntimeExecutable(commandName, {
      which: () => null,
      execPath: join("/tmp", "omo-runtime", "bun"),
    })

    // then
    expect(result).toEqual({ command: commandName, available: false })
  })

  test("#given an unsafe command name #when resolving #then does not trust the lookup result", () => {
    // given
    const unsafeName = "../node"

    // when
    const result = resolveRuntimeExecutable(unsafeName, {
      which: () => join("/tmp", "omo-runtime", "node"),
      execPath: join("/tmp", "omo-runtime", "node"),
    })

    // then
    expect(result).toEqual({ command: unsafeName, available: false })
  })

  test("#given the host process is node #when resolving node #then uses process execPath before PATH lookup", () => {
    // given
    const nodePath = join("/tmp", "omo-runtime", "node")

    // when
    const result = resolveRuntimeExecutable("node", {
      which: () => null,
      execPath: nodePath,
    })

    // then
    expect(result).toEqual({ command: nodePath, available: true })
  })
})
