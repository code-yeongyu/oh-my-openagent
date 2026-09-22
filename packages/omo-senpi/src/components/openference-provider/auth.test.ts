/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { hasOpenferenceCredential } from "./auth"

const tempDirs: string[] = []

function agentDirWith(authJson: unknown | string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-openference-auth-"))
  tempDirs.push(dir)
  if (authJson !== undefined) {
    writeFileSync(join(dir, "auth.json"), typeof authJson === "string" ? authJson : JSON.stringify(authJson), "utf8")
  }
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("hasOpenferenceCredential", () => {
  test("accepts a non-empty OPENFERENCE_API_KEY env var without auth.json", () => {
    // given the env var and an agent dir with no auth.json
    const dir = agentDirWith(undefined)

    // when the credential gate runs
    const connected = hasOpenferenceCredential({ agentDir: dir, env: { OPENFERENCE_API_KEY: "sk-test" } })

    // then the env var alone is a credential
    expect(connected).toBe(true)
  })

  test("rejects a blank or whitespace-only env var", () => {
    // given an empty and a whitespace-only env var
    const dir = agentDirWith(undefined)

    // when the credential gate runs
    expect(hasOpenferenceCredential({ agentDir: dir, env: { OPENFERENCE_API_KEY: "" } })).toBe(false)
    expect(hasOpenferenceCredential({ agentDir: dir, env: { OPENFERENCE_API_KEY: "   " } })).toBe(false)
  })

  test("accepts an auth.json openference entry shaped by the login flow", () => {
    // given auth.json with an openference entry carrying a type field
    const dir = agentDirWith({ openference: { type: "api_key", apiKey: "sk-test" } })

    // when the credential gate runs with no env var
    const connected = hasOpenferenceCredential({ agentDir: dir, env: {} })

    // then the stored entry is a credential
    expect(connected).toBe(true)
  })

  test("accepts an oauth-shaped openference entry", () => {
    // given auth.json with an openference oauth credential (no apiKey field)
    const dir = agentDirWith({ openference: { type: "oauth", refresh: "r", access: "a", expires: 1 } })

    // when the credential gate runs
    expect(hasOpenferenceCredential({ agentDir: dir, env: {} })).toBe(true)
  })

  test("rejects credential shapes the login flow never writes", () => {
    // given auth.json entries with unknown or missing types
    const unknownType = agentDirWith({ openference: { type: "magic", key: "sk-test" } })
    const noType = agentDirWith({ openference: { apiKey: "sk-test" } })

    // when the credential gate runs
    expect(hasOpenferenceCredential({ agentDir: unknownType, env: {} })).toBe(false)
    expect(hasOpenferenceCredential({ agentDir: noType, env: {} })).toBe(false)
  })

  test("ignores auth.json entries for other providers", () => {
    // given auth.json with only an unrelated provider entry
    const dir = agentDirWith({ xai: { type: "api_key", apiKey: "xai-key" } })

    // when the credential gate runs
    expect(hasOpenferenceCredential({ agentDir: dir, env: {} })).toBe(false)
  })

  test("rejects a non-object openference entry and malformed auth.json", () => {
    // given auth.json holding a string under openference, and an unparsable file
    const stringEntry = agentDirWith({ openference: "login" })
    const malformed = agentDirWith("{ not json")

    // when the credential gate runs
    expect(hasOpenferenceCredential({ agentDir: stringEntry, env: {} })).toBe(false)
    expect(hasOpenferenceCredential({ agentDir: malformed, env: {} })).toBe(false)
  })

  test("treats a missing agent dir as no stored credential", () => {
    // given an agent dir path that does not exist
    const missing = join(tmpdir(), "omo-openference-absent-dir")

    // when the credential gate runs with no env var
    // then it fails closed without throwing
    expect(hasOpenferenceCredential({ agentDir: missing, env: {} })).toBe(false)
  })
})
