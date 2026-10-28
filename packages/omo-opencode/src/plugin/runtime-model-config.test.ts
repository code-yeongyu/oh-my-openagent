import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OhMyOpenCodeConfig } from "../config"
import * as validation from "../config/validate"
import * as logger from "../shared/logger"
import { createRuntimeModelConfigLoader } from "./runtime-model-config"

const ENV_KEYS = ["HOME", "USERPROFILE", "OCX_PROFILE", "OMO_PROFILE", "OMO_CONFIG", "OMO_CONFIG_DIR", "OPENCODE_CONFIG_DIR"] as const

function withConfig(run: (project: string, path: string) => void): void {
  const environment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  const root = mkdtempSync(join(tmpdir(), "omo-runtime-model-config-"))
  const project = join(root, "project")
  const path = join(project, ".omo", "omo.jsonc")
  try {
    for (const key of ENV_KEYS) delete process.env[key]
    process.env.HOME = root
    process.env.USERPROFILE = root
    mkdirSync(join(project, ".omo"), { recursive: true })
    run(project, path)
  } finally {
    rmSync(root, { recursive: true, force: true })
    for (const key of ENV_KEYS) {
      const value = environment[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function writeConfig(path: string, config: unknown): void {
  writeFileSync(path, JSON.stringify({ "[opencode]": config }))
}

const initial: OhMyOpenCodeConfig = { agents: { explore: { model: "fixture/expensive" } } }

describe("runtime model config snapshots", () => {
  test("replaces snapshots on valid edits, materializes chains, and removes deleted overrides", () => {
    withConfig((project, path) => {
      const load = createRuntimeModelConfigLoader(project, initial)
      writeConfig(path, {
        agents: { explore: { models: [{ model: "fixture/cheap", reasoning: "low" }, "fixture/fallback"] } },
        categories: { runtime: { model: "fixture/cheap", variant: "low", fallback_models: ["fixture/fallback"] } },
      })
      const accepted = load()
      expect(accepted.agents?.explore).toMatchObject({ model: "fixture/cheap", reasoning: "low", fallback_models: ["fixture/fallback"] })
      expect(accepted.categories?.runtime).toMatchObject({ model: "fixture/cheap", variant: "low", fallback_models: ["fixture/fallback"] })
      expect(Object.keys(accepted).sort()).toEqual(["agents", "categories"])
      writeConfig(path, {})
      expect(load()).toEqual({ agents: undefined, categories: undefined })
      expect(accepted.agents?.explore?.model).toBe("fixture/cheap")
      expect(initial.agents?.explore?.model).toBe("fixture/expensive")
      rmSync(path)
      expect(load()).toEqual({ agents: undefined, categories: undefined })
    })
  })

  test("retains startup and latest good snapshots during malformed and invalid edits, then recovers", () => {
    withConfig((project, path) => {
      const logged = spyOn(logger, "log").mockImplementation(() => {})
      const load = createRuntimeModelConfigLoader(project, initial)
      writeFileSync(path, '{"[opencode]":')
      expect(load().agents?.explore?.model).toBe("fixture/expensive")
      writeConfig(path, { agents: { explore: { model: "fixture/cheap" } } })
      const accepted = load()
      writeConfig(path, { categories: { runtime: { model: 123, description: "keep category" } } })
      const pruned = validation.validatePluginConfig(project)
      expect(pruned.valid).toBe(true)
      expect(pruned.messages).toEqual([])
      expect(pruned.warnings.length).toBeGreaterThan(0)
      for (const config of [
        { agents: { explore: { model: 123 } } },
        { categories: { runtime: { model: 123, description: "keep category" } } },
        { agents: { explore: { model: "fixture/unaccepted" } }, unknown_runtime_key: true },
      ]) {
        writeConfig(path, config)
        expect(load()).toBe(accepted)
      }
      expect(logged).toHaveBeenCalledTimes(4)
      writeConfig(path, { agents: { explore: { model: "fixture/recovered" } } })
      expect(load().agents?.explore?.model).toBe("fixture/recovered")
      logged.mockRestore()
    })
  })

  test("retains last good snapshot and logs unexpected loader exceptions", () => {
    const failed = spyOn(validation, "validatePluginConfig").mockImplementation(() => { throw new Error("read failed") })
    const logged = spyOn(logger, "log").mockImplementation(() => {})
    try {
      const load = createRuntimeModelConfigLoader("/unused", initial)
      expect(load()).toEqual({ agents: initial.agents, categories: undefined })
      expect(logged.mock.calls[0]?.[0]).toContain("runtime-model-config")
      expect(logged.mock.calls[0]?.[1]).toMatchObject({ error: "read failed" })
    } finally {
      failed.mockRestore()
      logged.mockRestore()
    }
  })
})
