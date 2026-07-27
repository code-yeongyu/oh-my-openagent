import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSenpiOmoConfig } from "./index"

const roots: string[] = []

function fixture(): { readonly home: string; readonly project: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-config-resolution-"))
  roots.push(root)
  const home = join(root, "home")
  const project = join(home, "project")
  mkdirSync(join(home, ".omo"), { recursive: true })
  mkdirSync(project, { recursive: true })
  return { home, project }
}

function writeConfig(home: string, config: Record<string, unknown>): void {
  writeFileSync(join(home, ".omo", "omo.jsonc"), JSON.stringify(config), "utf8")
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("loadSenpiOmoConfig", () => {
  test("#given the current top-level-only Senpi categories and agents config #when resolved #then it preserves the established configuration exactly", () => {
    // given
    const { home, project } = fixture()
    writeConfig(home, {
      categories: {
        quick: { model: "apitopia/kimi-for-coding-highspeed-unlocked", reasoningEffort: "minimal" },
        deep: { fallback_models: ["quotio-openai/gpt-5.6-terra"] },
      },
      agents: {
        explore: { model: "apitopia/kimi-for-coding-highspeed", models: ["quotio-openai/gpt-5.4-mini-fast"] },
        oracle: { model: "quotio-openai/gpt-5.6-sol", reasoningEffort: "max" },
      },
    })

    // when
    const result = loadSenpiOmoConfig({ cwd: project, env: { HOME: home }, platform: "linux" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.categories).toEqual({
      quick: { model: "apitopia/kimi-for-coding-highspeed-unlocked", reasoningEffort: "minimal" },
      deep: { fallback_models: ["quotio-openai/gpt-5.6-terra"] },
    })
    expect(result.config.agents).toEqual({
      explore: { model: "apitopia/kimi-for-coding-highspeed", models: ["quotio-openai/gpt-5.4-mini-fast"] },
      oracle: { model: "quotio-openai/gpt-5.6-sol", reasoningEffort: "max" },
    })
  })

  test("#given base and activated Senpi profile category settings #when resolved #then the Senpi profile override wins", () => {
    // given
    const { home, project } = fixture()
    writeConfig(home, {
      categories: { quick: { model: "base/model" } },
      "[senpi]": { categories: { quick: { model: "senpi/model" } } },
      profiles: {
        focused: { "[senpi]": { categories: { quick: { model: "profile/model" } } } },
      },
    })

    // when
    const result = loadSenpiOmoConfig({ cwd: project, env: { HOME: home, OMO_PROFILE: "focused" }, platform: "linux" })

    // then
    expect(result.profile).toBe("focused")
    expect(result.config.categories?.quick?.model).toBe("profile/model")
  })

  test("#given catalog names in category and agent model chains #when resolved #then concrete model references and inherited attributes reach Senpi", () => {
    // given
    const { home, project } = fixture()
    writeConfig(home, {
      models: { fast: { model: "provider/fast", reasoningEffort: "low", variant: "rapid" } },
      categories: { quick: { fallback_models: ["fast"], model: "fast" } },
      agents: { finder: { model: "fast", models: ["fast"] } },
    })

    // when
    const result = loadSenpiOmoConfig({ cwd: project, env: { HOME: home }, platform: "linux" })

    // then
    expect(result.config.categories?.quick).toEqual({
      fallback_models: [{ model: "provider/fast", reasoningEffort: "low", variant: "rapid" }],
      model: "provider/fast",
      reasoningEffort: "low",
      variant: "rapid",
    })
    expect(result.config.agents?.finder).toEqual({
      model: "provider/fast",
      models: [{ model: "provider/fast", reasoningEffort: "low", variant: "rapid" }],
      reasoningEffort: "low",
      variant: "rapid",
    })
  })
})
