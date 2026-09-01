import { describe, expect, test } from "bun:test"

import { NameRegistry } from "./names"

describe("NameRegistry", () => {
  test("#given a fresh name #when registered #then it is used verbatim with no warning", () => {
    // given
    const registry = new NameRegistry()

    // when
    const result = registry.register("parent-a", "reviewer")

    // then
    expect(result.name).toBe("reviewer")
    expect(result.warning).toBeUndefined()
  })

  test("#given a colliding name in the same parent #when registered #then a -2 suffix and a warning are returned", () => {
    // given
    const registry = new NameRegistry()
    registry.register("parent-a", "reviewer")

    // when
    const result = registry.register("parent-a", "reviewer")

    // then
    expect(result.name).toBe("reviewer-2")
    expect(result.warning).toContain("reviewer")
  })

  test("#given two prior collisions #when registered again #then the suffix increments to -3", () => {
    // given
    const registry = new NameRegistry()
    registry.register("parent-a", "reviewer")
    registry.register("parent-a", "reviewer")

    // when
    const result = registry.register("parent-a", "reviewer")

    // then
    expect(result.name).toBe("reviewer-3")
  })

  test("#given the same name under a different parent #when registered #then there is no collision", () => {
    // given
    const registry = new NameRegistry()
    registry.register("parent-a", "reviewer")

    // when
    const result = registry.register("parent-b", "reviewer")

    // then
    expect(result.name).toBe("reviewer")
    expect(result.warning).toBeUndefined()
  })

  test("#given no requested name #when registered #then an auto name is generated and reserved", () => {
    // given
    const registry = new NameRegistry()

    // when
    const first = registry.register("parent-a", undefined, "st_00000001")
    const second = registry.register("parent-a", undefined, "st_00000002")

    // then
    expect(first.name).not.toBe(second.name)
  })

  test("#given a registered name #when released and re-registered #then the bare name is available", () => {
    // given
    const registry = new NameRegistry()
    registry.register("parent-a", "reviewer")

    // when
    registry.release("parent-a", "reviewer")
    const result = registry.register("parent-a", "reviewer")

    // then
    expect(result.name).toBe("reviewer")
    expect(result.warning).toBeUndefined()
  })

  test("#given an unknown name #when released #then registration is unchanged", () => {
    // given
    const registry = new NameRegistry()

    // when
    registry.release("parent-a", "reviewer")
    const result = registry.register("parent-a", "reviewer")

    // then
    expect(result.name).toBe("reviewer")
    expect(result.warning).toBeUndefined()
  })

  test("#given names in separate parents #when one is released #then the other remains reserved", () => {
    // given
    const registry = new NameRegistry()
    registry.register("parent-a", "reviewer")
    registry.register("parent-b", "reviewer")

    // when
    registry.release("parent-a", "reviewer")
    const result = registry.register("parent-b", "reviewer")

    // then
    expect(result.name).toBe("reviewer-2")
    expect(result.warning).toContain("reviewer")
  })
})
