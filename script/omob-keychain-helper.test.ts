/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureKeychainHelper, keychainHelperBuildArgs } from "./omob-keychain-helper"

type Call = { readonly command: string; readonly args: readonly string[]; readonly cwd: string }

function checkout(withBuildScript: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "omob-keychain-"))
  if (withBuildScript) {
    mkdirSync(join(root, "packages", "omo-native", "keychain-helper"), { recursive: true })
    writeFileSync(join(root, "packages", "omo-native", "keychain-helper", "build.ts"), "")
  }
  return root
}

function recorder(status: number): { readonly calls: Call[]; readonly run: (command: string, args: readonly string[], cwd: string) => number } {
  const calls: Call[] = []
  return { calls, run: (command, args, cwd) => { calls.push({ command, args, cwd }); return status } }
}

describe("omob keychain helper", () => {
  test("a darwin target builds the helper into the path build-omo-binary stages from", () => {
    const root = checkout(true)
    try {
      const { calls, run } = recorder(0)
      expect(ensureKeychainHelper(root, "darwin-arm64", run, () => {})).toBe("built")
      expect(calls).toEqual([{ command: "bun", args: keychainHelperBuildArgs(root), cwd: root }])
      expect(keychainHelperBuildArgs(root)).toEqual([
        join(root, "packages", "omo-native", "keychain-helper", "build.ts"),
        "--out",
        join(root, "packages", "omo-native", "bin", "darwin", "omo-keychain"),
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("non-darwin targets and checkouts that predate the helper build nothing", () => {
    const current = checkout(true)
    const older = checkout(false)
    try {
      const { calls, run } = recorder(0)
      expect(ensureKeychainHelper(current, "linux-x64", run, () => {})).toBe("skipped")
      expect(ensureKeychainHelper(older, "darwin-arm64", run, () => {})).toBe("skipped")
      expect(calls).toEqual([])
    } finally {
      rmSync(current, { recursive: true, force: true })
      rmSync(older, { recursive: true, force: true })
    }
  })

  test("a failed build stops the dev build with the exit code", () => {
    const root = checkout(true)
    try {
      expect(() => ensureKeychainHelper(root, "darwin-x64", recorder(1).run, () => {})).toThrow(/exit code 1/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
