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
        quick: { model: "kimi-coding/kimi-for-coding-highspeed-unlocked", reasoningEffort: "minimal" },
        "deep-low": { fallback_models: ["chatgpt-subscription/gpt-5.6-terra"] },
      },
      agents: {
        explore: { model: "kimi-coding/kimi-for-coding-highspeed", models: ["chatgpt-subscription/gpt-5.6-luna-fast"] },
        oracle: { model: "chatgpt-subscription/gpt-5.6-sol", reasoningEffort: "max" },
      },
    })

    // when
    const result = loadSenpiOmoConfig({ cwd: project, env: { HOME: home }, platform: "linux" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.categories).toEqual({
      quick: { model: "kimi-coding/kimi-for-coding-highspeed-unlocked", reasoning: "minimal" },
      "deep-low": { fallback_models: ["chatgpt-subscription/gpt-5.6-terra"] },
    })
    expect(result.config.agents).toEqual({
      explore: { model: "kimi-coding/kimi-for-coding-highspeed", models: ["chatgpt-subscription/gpt-5.6-luna-fast"] },
      oracle: { model: "chatgpt-subscription/gpt-5.6-sol", reasoning: "max" },
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
    // reasoningEffort outranks variant, so the catalog entry resolves to the canonical level only
    expect(result.config.categories?.quick).toEqual({
      fallback_models: [{ model: "provider/fast", reasoning: "low" }],
      model: "provider/fast",
      reasoning: "low",
    })
    expect(result.config.agents?.finder).toEqual({
      model: "provider/fast",
      models: [{ model: "provider/fast", reasoning: "low" }],
      reasoning: "low",
    })
  })

  test("#given an agent prompt_append file URI #when the Senpi config resolves #then the file content replaces the reference", () => {
    // given
    const { home, project } = fixture()
    writeFileSync(join(home, ".omo", "append.md"), "Prefer the smallest correct change.", "utf8")
    writeConfig(home, {
      agents: {
        explore: { model: "kimi-coding/kimi-for-coding-highspeed", prompt_append: "file://~/.omo/append.md" },
      },
    })

    // when
    const result = loadSenpiOmoConfig({ cwd: project, env: { HOME: home }, platform: "linux" })

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.config.agents?.explore?.prompt_append).toBe("Prefer the smallest correct change.")
  })

  test("#given an agent prompt_append file URI that cannot be resolved #when the Senpi config resolves #then a diagnostic is reported and the append is dropped", () => {
    // given
    const { home, project } = fixture()
    writeConfig(home, { agents: { explore: { model: "kimi-coding/x", prompt_append: "file://~/.omo/missing.md" } } })

    // when
    const result = loadSenpiOmoConfig({ cwd: project, env: { HOME: home }, platform: "linux" })

    // then
    const diagnostic = result.diagnostics.find((entry) => entry.kind === "prompt_append")
    expect(diagnostic?.message).toContain("agents.explore.prompt_append")
    expect(diagnostic?.message).toContain("file does not exist")
    expect(diagnostic?.path).toBe(join(home, ".omo", "omo.jsonc"))
    expect(result.config.agents?.explore?.prompt_append).toBeUndefined()
    expect(result.config.agents?.explore?.model).toBe("kimi-coding/x")
  })

  test("#given a prompt_append path that cannot be read as a file #when the Senpi config resolves #then the append is dropped without throwing", () => {
    // given
    const { home, project } = fixture()
    mkdirSync(join(home, ".omo", "append-dir.md"), { recursive: true })
    writeConfig(home, { agents: { explore: { prompt_append: "file://~/.omo/append-dir.md" } } })

    // when
    const result = loadSenpiOmoConfig({ cwd: project, env: { HOME: home }, platform: "linux" })

    // then
    expect(
      result.diagnostics.some(
        (entry) => entry.kind === "prompt_append" && entry.message.includes("file could not be read"),
      ),
    ).toBe(true)
    expect(result.config.agents?.explore?.prompt_append).toBeUndefined()
  })
})
