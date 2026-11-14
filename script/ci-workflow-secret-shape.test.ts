/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"

const WORKFLOW_DIR = new URL("../.github/workflows/", import.meta.url)

// Guards the security-scanner contract: the secret gate on every PR matches a password-shaped key
// assigned a quoted literal, and a PR that merges dev lands these workflow lines as ADDED lines in
// its merge commit, so one literal is re-reported on every PR that merges dev (#11654, #11931).
const PASSWORD_SHAPED_LITERAL = /(?:password|passwd|pwd)[A-Za-z0-9_-]*["']?\s*[:=]\s*["'][^"']{3,}/i

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort()
}

function offendingLines(name: string): number[] {
  const text = readFileSync(new URL(name, WORKFLOW_DIR), "utf8")
  return text
    .split("\n")
    .flatMap((line, index) => (PASSWORD_SHAPED_LITERAL.test(line) ? [index + 1] : []))
}

describe("#given the committed workflows and a scanner that matches password-shaped literals", () => {
  test("#then no workflow assigns a quoted literal to a password-shaped key", () => {
    // given / when
    const offenders = workflowFiles().flatMap((name) => offendingLines(name).map((line) => `${name}:${line}`))

    // then - file and line only: echoing the match would echo the literal
    expect(offenders).toEqual([])
  })
})
