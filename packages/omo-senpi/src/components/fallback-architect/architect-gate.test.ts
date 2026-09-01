/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { hasActiveArchitectCategory, type GateRegistry } from "./architect-gate"

type FakeModel = { readonly provider: string; readonly id: string }

function fakeRegistry(models: readonly FakeModel[]): GateRegistry {
  return {
    getAvailable: () => models,
    find: (provider: string, modelId: string) =>
      models.find((model) => model.provider === provider && model.id === modelId),
  }
}

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

  describe("#given no user architect entry but a live registry exposing the gate model", () => {
    describe("#when the gate is evaluated with that registry", () => {
      it("#then the builtin architect category counts as active", () => {
        withFixture({ categories: { quick: { model: "some/model" } } }, (cwd, env) => {
          const registry = fakeRegistry([{ provider: "anthropic", id: "claude-fable-5" }])
          expect(hasActiveArchitectCategory(cwd, { env, registry })).toBe(true)
        })
      })
    })
  })

  describe("#given no user architect entry and a live registry without the gate model", () => {
    describe("#when the gate is evaluated with that registry", () => {
      it("#then the category does not count as active", () => {
        withFixture({ categories: { quick: { model: "some/model" } } }, (cwd, env) => {
          const registry = fakeRegistry([{ provider: "omo-mock", id: "mock-weak" }])
          expect(hasActiveArchitectCategory(cwd, { env, registry })).toBe(false)
        })
      })
    })
  })

  describe("#given a config that disables architect and a registry that exposes the gate model", () => {
    describe("#when the gate is evaluated", () => {
      it("#then the explicit disable still wins over the runtime listing", () => {
        withFixture({ categories: { architect: { disable: true } } }, (cwd, env) => {
          const registry = fakeRegistry([{ provider: "anthropic", id: "claude-fable-5" }])
          expect(hasActiveArchitectCategory(cwd, { env, registry })).toBe(false)
        })
      })
    })
  })

  describe("#given no user architect entry and a registry whose getAvailable throws", () => {
    describe("#when the gate is evaluated", () => {
      it("#then it degrades to the ungated runtime list instead of throwing", () => {
        withFixture({ categories: { quick: { model: "some/model" } } }, (cwd, env) => {
          const registry: GateRegistry = {
            getAvailable: () => {
              throw new Error("registry not ready")
            },
            find: () => undefined,
          }
          expect(hasActiveArchitectCategory(cwd, { env, registry })).toBe(true)
        })
      })
    })
  })
})
