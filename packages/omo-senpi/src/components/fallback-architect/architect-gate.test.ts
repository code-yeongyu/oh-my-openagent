/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { hasActiveArchitectCategory } from "./architect-gate"

/**
 * The loader also reads the real user config at $HOME/.omo, so every fixture pins HOME at an
 * empty temp dir. Without that the developer machine's own architect category would answer the
 * assertions instead of the fixture.
 */
function withFixture(config: unknown | undefined, run: (cwd: string, env: Record<string, string>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "omo-architect-gate-"))
  try {
    const home = join(root, "home")
    const project = join(root, "project")
    mkdirSync(home, { recursive: true })
    mkdirSync(join(project, ".omo"), { recursive: true })
    if (config !== undefined) {
      writeFileSync(join(project, ".omo", "omo.json"), JSON.stringify(config), "utf-8")
    }
    run(project, { HOME: home, USERPROFILE: home })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("architect gate", () => {
  describe("#given a project config that declares the architect category", () => {
    describe("#when the gate is evaluated", () => {
      it("#then the category counts as active", () => {
        withFixture({ categories: { architect: { model: "anthropic/claude-fable-5" } } }, (cwd, env) => {
          expect(hasActiveArchitectCategory(cwd, { env })).toBe(true)
        })
      })
    })
  })

  describe("#given a project config that disables the architect category", () => {
    describe("#when the gate is evaluated", () => {
      it("#then the category does not count as active", () => {
        withFixture({ categories: { architect: { model: "anthropic/claude-fable-5", disable: true } } }, (cwd, env) => {
          expect(hasActiveArchitectCategory(cwd, { env })).toBe(false)
        })
      })
    })
  })

  describe("#given a project config without an architect category", () => {
    describe("#when the gate is evaluated", () => {
      it("#then the category does not count as active", () => {
        withFixture({ categories: { quick: { model: "some/model" } } }, (cwd, env) => {
          expect(hasActiveArchitectCategory(cwd, { env })).toBe(false)
        })
      })
    })
  })

  describe("#given no omo config at all", () => {
    describe("#when the gate is evaluated", () => {
      it("#then it returns false instead of throwing", () => {
        withFixture(undefined, (cwd, env) => {
          expect(hasActiveArchitectCategory(cwd, { env })).toBe(false)
        })
      })
    })
  })
})
