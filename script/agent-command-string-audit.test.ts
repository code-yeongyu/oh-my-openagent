/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { collectHits } from "./agent-command-string-scan"

const WORKSPACE_ROOT = resolve(import.meta.dir, "..")
const ALLOWLIST_PATH = resolve(WORKSPACE_ROOT, "script/agent-command-string-audit.allowlist.json")
const ALLOWLIST_CATEGORIES = ["emit-migrate", "test-expectation", "input-compat-preserve", "docs"] as const

type AllowlistCategory = (typeof ALLOWLIST_CATEGORIES)[number]
type Allowlist = Record<AllowlistCategory, string[]>

function readAllowlist(): Allowlist {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allowlist
}

const AUDIT_TIMEOUT_MS = 120_000

describe("agent command string audit", () => {
  test("#given tracked source files #when legacy agent and human commands are scanned #then every hit is categorized", () => {
    const allowlist = readAllowlist()
    expect(Object.keys(allowlist).sort()).toEqual([...ALLOWLIST_CATEGORIES].sort())

    expect(allowlist["emit-migrate"]).toEqual([])
    expect(allowlist["test-expectation"]).toEqual([])

    const categorized = ALLOWLIST_CATEGORIES.flatMap((category) => allowlist[category])
    expect(new Set(categorized).size, "allowlist entries must be unique").toBe(categorized.length)
    expect(collectHits(WORKSPACE_ROOT)).toEqual(categorized.sort())
  }, AUDIT_TIMEOUT_MS)

  test("#given allowlist entries #when inspected #then none carries a line number pin", () => {
    const categorized = ALLOWLIST_CATEGORIES.flatMap((category) => readAllowlist()[category])
    const linePinned = categorized.filter((entry) => /^[^:]+:\d+:/.test(entry))
    expect(linePinned, "allowlist entries must stay line-number-free so doc and release-stamp line shifts cannot break the release gate").toEqual([])
  })
})
