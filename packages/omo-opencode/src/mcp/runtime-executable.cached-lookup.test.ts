/// <reference types="bun-types" />

import { afterEach, expect, mock, test } from "bun:test"

const savedPath = process.env.PATH

afterEach(() => {
  mock.restore()
  process.env.PATH = savedPath
})

test("resolveRuntimeExecutable remembers default PATH lookups per PATH value (local fix 47)", async () => {
  // given
  const lookups: string[] = []
  mock.module("../shared/bun-which-shim", () => ({
    bunWhich: (name: string) => {
      lookups.push(name)
      return name === "fix47-present" ? `/bin/${name}` : null
    },
  }))
  const { resolveRuntimeExecutable } = await import("./runtime-executable")
  process.env.PATH = "/fix47/a"

  // when
  const first = resolveRuntimeExecutable("fix47-present")
  const again = resolveRuntimeExecutable("fix47-present")
  const missing = resolveRuntimeExecutable("fix47-missing")
  const missingAgain = resolveRuntimeExecutable("fix47-missing")
  process.env.PATH = "/fix47/b"
  const afterPathChange = resolveRuntimeExecutable("fix47-present")

  // then
  expect(first).toEqual({ command: "/bin/fix47-present", available: true })
  expect(again).toEqual(first)
  expect(missing).toEqual({ command: "fix47-missing", available: false })
  expect(missingAgain).toEqual(missing)
  expect(afterPathChange).toEqual(first)
  expect(lookups).toEqual(["fix47-present", "fix47-missing", "fix47-present"])
})

test("resolveRuntimeExecutable never caches an injected lookup", async () => {
  // given
  const { resolveRuntimeExecutable } = await import("./runtime-executable")
  let calls = 0
  const which = () => {
    calls += 1
    return "/x/tool"
  }

  // when
  resolveRuntimeExecutable("tool", { which })
  resolveRuntimeExecutable("tool", { which })

  // then
  expect(calls).toBe(2)
})
