import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { validatePluginConfig } from "./validate"

function withProjectConfig<T>(name: string, config: unknown, run: (project: string) => T): T {
  const home = process.env.HOME
  const ocxProfile = process.env.OCX_PROFILE
  const omoProfile = process.env.OMO_PROFILE
  const root = mkdtempSync(join(tmpdir(), `omo-config-validate-pipeline-${name}-`))
  const project = join(root, "project")

  try {
    process.env.HOME = root
    delete process.env.OCX_PROFILE
    delete process.env.OMO_PROFILE
    mkdirSync(join(project, ".omo"), { recursive: true })
    writeFileSync(join(project, ".omo", "omo.jsonc"), `${JSON.stringify(config)}\n`, "utf-8")
    return run(project)
  } finally {
    rmSync(root, { recursive: true, force: true })
    if (home === undefined) delete process.env.HOME
    else process.env.HOME = home
    if (ocxProfile === undefined) delete process.env.OCX_PROFILE
    else process.env.OCX_PROFILE = ocxProfile
    if (omoProfile === undefined) delete process.env.OMO_PROFILE
    else process.env.OMO_PROFILE = omoProfile
  }
}

describe("validatePluginConfig pipeline", () => {
  it("#given a partially invalid omo opencode view #when validating #then retains valid sections", () => {
    withProjectConfig("partial", {
      "[opencode]": {
        agents: { sisyphus: { model: 123 } },
        tui: { sidebar: { enabled: false } },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.valid).toBe(false)
      expect(result.config.tui?.sidebar.enabled).toBe(false)
      expect(result.messages.some((message) => message.includes("agents.sisyphus.model"))).toBe(true)
    })
  })

  it("#given a disabled provider in an omo opencode view #when validating #then substitutes its allowed fallback", () => {
    withProjectConfig("disabled-provider", {
      "[opencode]": {
        disabled_providers: ["blocked"],
        agents: { sisyphus: { model: "blocked/primary", fallback_models: ["allowed/fallback"] } },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.agents?.sisyphus?.model).toBe("allowed/fallback")
    })
  })

  it("#given a legacy ralph_loop omo opencode view #when validating #then migrates it to goal", () => {
    withProjectConfig("ralph-loop", {
      "[opencode]": { ralph_loop: { enabled: true, default_max_iterations: 50 } },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.goal).toMatchObject({ enabled: true, auto_start: false, default_max_iterations: 50 })
    })
  })

  it("#given explicit goal settings beside ralph_loop #when validating #then preserves explicit goal values", () => {
    withProjectConfig("goal-override", {
      "[opencode]": {
        goal: { enabled: false, default_max_iterations: 75 },
        ralph_loop: { enabled: true, default_max_iterations: 50 },
      },
    }, (project) => {
      const result = validatePluginConfig(project)

      expect(result.config.goal?.enabled).toBe(false)
      expect(result.config.goal?.default_max_iterations).toBe(75)
    })
  })
})
