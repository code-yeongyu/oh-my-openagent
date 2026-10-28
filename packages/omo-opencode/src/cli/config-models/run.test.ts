import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { runConfigModels } from "./index"
import type { ConfigModelsReport } from "./types"

const roots: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-config-models-"))
  roots.push(root)
  const home = join(root, "home")
  const directory = join(home, "project", "nested")
  mkdirSync(directory, { recursive: true })
  const user = join(home, ".omo", "omo.jsonc")
  const project = join(home, "project", ".omo", "omo.jsonc")
  const local = join(directory, ".omo", "omo.jsonc")
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value, null, 2))
  }
  const run = (json = true, environment: Record<string, string> = {}) => {
    const lines: string[] = []
    const code = runConfigModels({ directory, environment: { HOME: home, ...environment }, json, output: (line) => lines.push(line) })
    return { code, text: lines.join("\n"), report: json ? JSON.parse(lines.join("\n")) as ConfigModelsReport : undefined }
  }
  return { directory, home, local, project, root, run, user, write }
}

function fileBytes(root: string): Record<string, string> {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return [path, readFileSync(path).toString("base64")]
    }))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe("config models public report", () => {
  test("#given walked layers and an active profile #when mapped #then declarations retain canonical source/section order and private fields stay private", () => {
    // given
    const f = fixture()
    f.write(f.user, {
      agents: { oracle: { model: "provider/base", prompt: "PRIVATE_PROMPT" } },
      "[opencode]": { agents: { custom: { category: "research", models: ["catalog-entry", { model: "provider/second", reasoning: "high", temperature: 1 }], fallback_models: ["provider/third"], providerOptions: { token: "PRIVATE_PROVIDER" }, tools: { bash: true } } } },
      profiles: { focused: { agents: { oracle: { model: "provider/profile" } }, "[opencode]": { agents: { custom: { disable: true, variant: "max" } } } }, ignored: { agents: { hidden: { model: "PRIVATE_INACTIVE" } } } },
    })
    f.write(f.project, {
      categories: { research: { models: ["provider/research", { model: "provider/research-fallback", variant: "low", provider_options: { token: "PRIVATE_CHAIN" } }], fallback_models: "provider/legacy", variant: "high" } },
      "[opencode]": { categories: { research: { model: "provider/override" } }, mcp: { secret: "PRIVATE_ENV" } },
      profiles: { focused: { categories: { research: { model: "provider/profile-category" } }, "[opencode]": { agents: { oracle: { category: "research" } } } } },
    })
    f.write(f.local, { "[opencode]": { agents: { oracle: { model: "provider/local" } } } })
    const before = fileBytes(f.root)

    // when
    const result = f.run(true, { OMO_PROFILE: "focused" })

    // then
    expect(result.code).toBe(0)
    expect(result.report?.profile).toBe("focused")
    expect(result.report?.views.map((view) => [view.path, view.keyPrefix])).toEqual([
      [f.user, ""], [f.project, ""],
      [f.user, "[opencode]."], [f.project, "[opencode]."], [f.local, "[opencode]."],
      [f.user, "profiles.focused."], [f.project, "profiles.focused."],
      [f.user, "profiles.focused.[opencode]."], [f.project, "profiles.focused.[opencode]."],
    ])
    const custom = result.report?.views[2]?.declarations[0]
    expect(custom).toEqual({ key: "[opencode].agents.custom", section: "agents", name: "custom", category: "research", models: ["catalog-entry", { model: "provider/second", reasoning: "high" }], fallback_models: ["provider/third"] })
    expect(result.report?.views[1]?.declarations[0]).toMatchObject({ models: ["provider/research", { model: "provider/research-fallback", reasoning: "low" }], reasoning: "high", fallback_models: "provider/legacy" })
    expect(result.report?.diagnostics.some((entry) => entry.kind === "unknown-keys" && entry.issuePaths.includes("[opencode].mcp"))).toBe(true)
    expect(result.report?.sources.map((source) => [source.scope, source.status])).toEqual([["user", "loaded"], ["project", "loaded"], ["project", "loaded"]])
    expect(result.text).not.toContain("PRIVATE_")
    expect(result.text).not.toContain("providerOptions")
    expect(result.text).not.toContain('"tools"')
    expect(fileBytes(f.root)).toEqual(before)
  })

  test("#given a rejected file and invalid OpenCode leaves #when mapped #then errors are visible and only valid leaves survive without writes", () => {
    // given
    const f = fixture()
    f.write(f.user, '{"agents": {"oracle": {"model": "PRIVATE_BROKEN"}},')
    f.write(f.project, { "[opencode]": { agents: { custom: { model: 42, category: "research", models: ["provider/good"], prompt: 7, providerOptions: { token: "PRIVATE_TOKEN" } } }, categories: { research: { model: "provider/valid", disable: "PRIVATE_INVALID" } } } })
    const before = fileBytes(f.root)

    // when
    const result = f.run()
    const text = f.run(false)

    // then
    expect(text.code).toBe(1)
    expect(text.text).toContain("[user/rejected]")
    expect(text.text).toContain("error: parse:")
    expect(text.text).not.toContain("PRIVATE_")
    expect(result.code).toBe(1)
    expect(result.report?.valid).toBe(false)
    expect(result.report?.sources.map((source) => source.status)).toEqual(["rejected", "partial"])
    expect(result.report?.views).toHaveLength(1)
    expect(result.report?.views[0]?.declarations).toEqual([
      { section: "agents", name: "custom", key: "[opencode].agents.custom", category: "research", models: ["provider/good"] },
      { section: "categories", name: "research", key: "[opencode].categories.research", model: "provider/valid" },
    ])
    expect(result.report?.diagnostics.some((entry) => entry.kind === "parse" && entry.path === f.user)).toBe(true)
    expect(result.report?.diagnostics.some((entry) => entry.issuePaths.includes("[opencode].agents.custom.model"))).toBe(true)
    expect(result.text).not.toContain("PRIVATE_")
    expect(fileBytes(f.root)).toEqual(before)
  })

  test("#given invalid shared model fields #when mapped #then core diagnostics remain visible without echoing invalid values", () => {
    // given
    const f = fixture()
    f.write(f.user, { agents: { oracle: { model: 42 }, custom: { model: "provider/retained" } }, categories: { research: { model: "provider/category", reasoning: { token: "PRIVATE_REASONING" } } } })

    // when
    const result = f.run()

    // then
    expect(result.code).toBe(1)
    expect(result.report?.sources[0]?.status).toBe("partial")
    expect(result.report?.diagnostics.some((entry) => entry.kind === "invalid-value")).toBe(true)
    expect(result.report?.views[0]?.declarations.find((entry) => entry.name === "custom")?.model).toBe("provider/retained")
    expect(result.text).not.toContain("PRIVATE_REASONING")
  })

  test("#given no configuration #when printed as text #then it gives guidance and creates no files", () => {
    // given
    const f = fixture()
    const before = fileBytes(f.root)

    // when
    const result = f.run(false)
    const json = f.run()

    // then
    expect(json.code).toBe(0)
    expect(json.report?.views).toEqual([])
    expect(json.report?.valid).toBe(true)
    expect(result.code).toBe(0)
    expect(result.text).toContain("No agent or category model declarations")
    expect(result.text).toContain(".omo/omo.jsonc")
    expect(result.text).toContain("missing")
    expect(fileBytes(f.root)).toEqual(before)
  })

  test("#given category links and mixed fallback declarations #when printed as text #then it preserves field labels, ordering and source attribution", () => {
    // given
    const f = fixture()
    f.write(f.user, { "[opencode]": { agents: { custom: { category: "research", model: "provider/primary", models: ["provider/one", { model: "provider/two", variant: "high" }], fallback_models: ["provider/three", "provider/four"], disable: false } } } })

    // when
    const result = f.run(false)

    // then
    expect(result.code).toBe(0)
    expect(result.text).toContain(f.user)
    expect(result.text).toContain("[opencode].agents.custom")
    expect(result.text).toContain("category -> research")
    expect(result.text).toContain("models[0] -> provider/one")
    expect(result.text).toContain("models[1] -> provider/two (variant=high)")
    expect(result.text.indexOf("fallback_models[0] -> provider/three")).toBeLessThan(result.text.indexOf("fallback_models[1] -> provider/four"))
    expect(result.text).toContain("disable = false")
    expect(result.text).toContain("Declarations")
  })

  test("#given terminal control characters in declarations #when printed #then text escapes them and JSON preserves structured strings", () => {
    // given
    const f = fixture()
    const name = "custom\u001b[2J\ninjected-header"
    const model = "provider/model\rhidden\b\u009b31m"
    const category = "research\t\u001b[31m"
    f.write(f.user, { "[opencode]": { agents: { [name]: { model, category } } } })
    const before = fileBytes(f.root)

    // when
    const text = f.run(false)
    const json = f.run()

    // then
    expect(text.code).toBe(0)
    expect(text.text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/)
    expect(text.text).not.toContain("\ninjected-header")
    expect(text.text).toContain("custom\\u001b[2J\\ninjected-header")
    expect(json.report?.views[0]?.declarations[0]).toMatchObject({ name, model, category })
    expect(fileBytes(f.root)).toEqual(before)
  })

  test("#given a catalog cycle spanning source files #when mapped #then merged keys are explicit and never presented as source filenames", () => {
    // given
    const f = fixture()
    f.write(f.user, { models: { loop: { model: "hop" } }, "[opencode]": { agents: { custom: { model: "loop" } } } })
    f.write(f.project, { models: { hop: { model: "loop" } } })
    const before = fileBytes(f.root)

    // when
    const json = f.run()
    const text = f.run(false)

    // then
    expect(json.code).toBe(1)
    expect(text.code).toBe(1)
    expect(json.report?.valid).toBe(false)
    expect(json.report?.diagnostics).toContainEqual({
      kind: "model_catalog_cycle", severity: "error", scope: "merged", path: null,
      issuePaths: ["models.loop.model"], message: "Model catalog contains a reference cycle.",
    })
    expect(json.report?.sources.map((source) => source.status)).toEqual(["loaded", "loaded"])
    expect(text.text).toContain("merged configuration | keys: models.loop.model")
    expect(fileBytes(f.root)).toEqual(before)
  })

  test("#given deprecated keys or an absent requested profile #when mapped #then notices succeed but profile failure returns nonzero", () => {
    // given
    const f = fixture()
    f.write(f.user, { categories: { "unspecified-high": { model: "provider/base" } }, "[senpi]": { agents: {} } })

    // when
    const notice = f.run()
    const missing = f.run(true, { OMO_PROFILE: "missing" })

    // then
    expect(notice.code).toBe(0)
    expect(notice.report?.diagnostics.some((entry) => entry.kind === "deprecated-keys" && entry.severity === "warning")).toBe(true)
    expect(missing.code).toBe(1)
    expect(missing.report?.profile).toBeNull()
    expect(missing.report?.diagnostics.some((entry) => entry.kind === "profile" && entry.severity === "error")).toBe(true)
  })
})
