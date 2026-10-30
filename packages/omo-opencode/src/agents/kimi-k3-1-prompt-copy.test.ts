import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), "utf8")

// Architecture contract (Q, 2026-10-24): K3.1 owns a copy of the K3 prompts, so a later K3 edit
// never reaches K3.1. An import of the K3 module is the one way that contract breaks.
describe("Kimi K3.1 prompt modules", () => {
  test("#given the K3.1 prompt modules #then neither imports its K3 sibling", () => {
    expect(read("./sisyphus/kimi-k3-1.ts")).not.toMatch(/from "\.\/kimi-k3"/)
    expect(read("./sisyphus-junior/kimi-k3-1.ts")).not.toMatch(/from "\.\/kimi-k3"/)
  })
})
