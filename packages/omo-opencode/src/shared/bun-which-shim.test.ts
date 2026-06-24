import { describe, expect, test } from "bun:test"
import { bunWhich as sharedBunWhich } from "@oh-my-opencode/utils/runtime"

import { bunWhich } from "./bun-which-shim"

const PATH_TRAVERSAL_COMMAND_NAMES = [
  "../etc/passwd",
  "/etc/passwd",
  "./tool",
  "sub/dir/tool",
  "C:\\Windows\\evil",
  "C:tool",
  ".",
  "..",
  "node..evil",
] as const

const NULL_BYTE_COMMAND_NAME = "node\0evil"

describe("bunWhich", () => {
  test("#given old shared shim path #when imported #then it re-exports the shared runtime implementation", () => {
    expect(bunWhich).toBe(sharedBunWhich)
  })

  test("#given 'node' command #when resolved #then returns a non-null path ending in 'node'", () => {
    const resolvedPath = bunWhich("node")

    expect(resolvedPath).not.toBeNull()
    expect(resolvedPath?.toLowerCase()).toMatch(/node(?:\.exe)?$/)
  })

  test("#given a non-existent command #when resolved #then returns null", () => {
    const resolvedPath = bunWhich("this-command-definitely-does-not-exist-abc123xyz")

    expect(resolvedPath).toBeNull()
  })

  test("#given an empty string #when resolved #then returns null", () => {
    const resolvedPath = bunWhich("")

    expect(resolvedPath).toBeNull()
  })

  test("#given the result for 'node' #when resolved #then the returned path matches Bun.which('node')", () => {
    const runtime = globalThis as typeof globalThis & { readonly Bun?: { which(commandName: string): string | null } }
    const nativePath = runtime.Bun?.which("node")
    const shimPath = bunWhich("node")

    expect(nativePath).not.toBeNull()
    expect(shimPath).toBe(nativePath)
  })

  test("#given path-traversal command names #when resolved through Bun runtime #then returns null", () => {
    for (const commandName of PATH_TRAVERSAL_COMMAND_NAMES) {
      expect(bunWhich(commandName)).toBeNull()
    }
  })

  test("#given a null-byte command name #when resolved through Bun runtime #then returns null", () => {
    expect(bunWhich(NULL_BYTE_COMMAND_NAME)).toBeNull()
  })
})
