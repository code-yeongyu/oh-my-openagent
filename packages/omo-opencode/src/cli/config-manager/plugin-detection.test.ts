import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resetConfigContext } from "./config-context"
import { detectCurrentConfig } from "./detect-current-config"
import { addPluginToOpenCodeConfig } from "./add-plugin-to-opencode-config"
import * as pluginNameWithVersion from "./plugin-name-with-version"
import { parseJsonc } from "../../shared"

const sourcePlugin = new URL("../../index.ts", import.meta.url).href

describe("detectCurrentConfig - single package detection", () => {
  let testConfigDir = ""
  let homeDirectory = ""
  let originalHome: string | undefined
  let testConfigPath = ""
  let testOmoConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-detect-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    homeDirectory = join(testConfigDir, "home")
    testConfigPath = join(testConfigDir, "opencode.json")
    testOmoConfigPath = join(homeDirectory, ".omo", "omo.jsonc")

    mkdirSync(join(testOmoConfigPath, ".."), { recursive: true })
    originalHome = process.env.HOME
    process.env.HOME = homeDirectory
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  })

  it("detects both legacy and canonical plugin entries", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode", "oh-my-openagent@3.11.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
  })

  it("returns false when plugin not present with similar name", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent-extra"] }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(false)
  })

  it("detects OpenCode Go from the existing omo config", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")
    writeFileSync(testOmoConfigPath, JSON.stringify({
      "[opencode]": { agents: { atlas: { model: "opencode-go/kimi-k2.6" } } },
    }, null, 2) + "\n", "utf-8")

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
    expect(result.hasOpencodeGo).toBe(true)
  })

  it("uses default provider detection when omo config reading throws a non-Error value", () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")
    writeFileSync(testOmoConfigPath, "{}\n", "utf-8")
    const originalReadFileSync = fs.readFileSync
    const readFileSyncSpy = spyOn(fs, "readFileSync").mockImplementation((filePath, options) => {
      if (String(filePath).replaceAll("\\", "/").endsWith(".omo/omo.jsonc")) {
        throw "read failed"
      }
      return originalReadFileSync(filePath, options)
    })

    try {
      // when
      const result = detectCurrentConfig()

      // then
      expect(result.isInstalled).toBe(true)
      expect(result.hasOpenAI).toBe(true)
      expect(result.hasOpencodeZen).toBe(true)
      expect(result.hasOpencodeGo).toBe(false)
    } finally {
      readFileSyncSpy.mockRestore()
    }
  })
})

describe("addPluginToOpenCodeConfig - single package writes", () => {
  let testConfigDir = ""
  let testConfigPath = ""
  let getPluginNameWithVersionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-add-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, "opencode.json")

    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
    // Mock npm dist-tags lookup so tests don't make real network calls that
    // timeout under CI load. Individual tests override this with version-pinned
    // expectations when they need to assert on the version-tagged entry.
    getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent")
  })

  afterEach(() => {
    getPluginNameWithVersionSpy.mockRestore()
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("writes canonical plugin entry for new installs", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({}, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent"])
  })

  it("upgrades a bare legacy plugin entry to canonical", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent"])
  })

  it("updates a version-pinned legacy entry to the requested version", async () => {
    // given
    const getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent@3.16.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-opencode@3.15.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.16.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.16.0"])
    getPluginNameWithVersionSpy.mockRestore()
  })

  it("removes stale legacy entry when canonical and legacy entries both exist", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent", "oh-my-opencode"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent"])
  })

  it("preserves a canonical entry when the same version is re-installed", async () => {
    // given
    const getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent@3.10.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent@3.10.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.10.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.10.0"])
    getPluginNameWithVersionSpy.mockRestore()
  })

  it("blocks a downgrade for a version-pinned canonical entry", async () => {
    // given
    const getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent@3.15.0")
    writeFileSync(testConfigPath, JSON.stringify({ plugin: ["oh-my-openagent@3.16.0"] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.15.0")

    // then
    expect(result.success).toBe(false)
    expect(result.error).toContain("Downgrade")

    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual(["oh-my-openagent@3.16.0"])
    getPluginNameWithVersionSpy.mockRestore()
  })

  it("rewrites quoted jsonc plugin field in place", async () => {
    // given
    testConfigPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(testConfigPath, '{\n  "plugin": ["oh-my-opencode"]\n}\n', "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedContent = readFileSync(testConfigPath, "utf-8")
    expect(savedContent.includes('"plugin": [\n    "oh-my-openagent"\n  ]')).toBe(true)
    expect(savedContent.includes("oh-my-opencode")).toBe(false)
  })

  it("mirrors an existing source plugin entry into profile configs", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: [sourcePlugin] }, null, 2) + "\n", "utf-8")

    const profileDir = join(testConfigDir, "profiles", "today")
    const profileConfigPath = join(profileDir, "opencode.json")
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      profileConfigPath,
      JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedRootConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    const savedProfileConfig = JSON.parse(readFileSync(profileConfigPath, "utf-8"))
    expect(savedRootConfig.plugin).toEqual([sourcePlugin])
    expect(savedProfileConfig.plugin).toEqual([sourcePlugin])
  })

  it("uses the parent source plugin entry when OPENCODE_CONFIG_DIR points at a profile", async () => {
    // given
    writeFileSync(testConfigPath, JSON.stringify({ plugin: [sourcePlugin] }, null, 2) + "\n", "utf-8")

    const profileDir = join(testConfigDir, "profiles", "today")
    const profileConfigPath = join(profileDir, "opencode.json")
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(
      profileConfigPath,
      JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2) + "\n",
      "utf-8",
    )

    process.env.OPENCODE_CONFIG_DIR = profileDir
    resetConfigContext()

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    expect(result.configPath).toBe(join(realpathSync(profileDir), "opencode.json"))
    const savedProfileConfig = JSON.parse(readFileSync(profileConfigPath, "utf-8"))
    expect(savedProfileConfig.plugin).toEqual([sourcePlugin])
  })
})

// Regression for https://github.com/code-yeongyu/oh-my-openagent/issues/6555
// OpenCode documents and supports tuple-style plugin entries `[name, options]`.
// omo's installer predicates previously called `.startsWith`/`.toLowerCase`
// without a `typeof` guard, so the first tuple entry crashed the installer
// with `TypeError: plugin.startsWith is not a function`.
describe("detectCurrentConfig - tuple plugin entries (#6555)", () => {
  let testConfigDir = ""
  let homeDirectory = ""
  let originalHome: string | undefined
  let testConfigPath = ""
  let testOmoConfigPath = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-tuple-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    homeDirectory = join(testConfigDir, "home")
    testConfigPath = join(testConfigDir, "opencode.json")
    testOmoConfigPath = join(homeDirectory, ".omo", "omo.jsonc")

    mkdirSync(join(testOmoConfigPath, ".."), { recursive: true })
    originalHome = process.env.HOME
    process.env.HOME = homeDirectory
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  })

  it("does not throw and reports not installed when plugin array has only a tuple entry", () => {
    // given - a tuple-style entry (documented OpenCode format) and no omo entry
    writeFileSync(
      testConfigPath,
      JSON.stringify({ plugin: [["@plannotator/opencode@latest", { workflow: "plan-agent" }]] }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = detectCurrentConfig()

    // then - previously this threw `plugin.startsWith is not a function`
    expect(result.isInstalled).toBe(false)
    expect(result.installedVersion).toBe(null)
  })

  it("detects an omo entry alongside a tuple entry", () => {
    // given
    writeFileSync(
      testConfigPath,
      JSON.stringify({
        plugin: [
          ["@plannotator/opencode@latest", { workflow: "plan-agent" }],
          "oh-my-openagent@3.11.0",
        ],
      }, null, 2) + "\n",
      "utf-8",
    )

    // when
    const result = detectCurrentConfig()

    // then
    expect(result.isInstalled).toBe(true)
    expect(result.installedVersion).toBe("3.11.0")
  })
})

describe("addPluginToOpenCodeConfig - tuple plugin entries (#6555)", () => {
  let testConfigDir = ""
  let testConfigPath = ""
  let getPluginNameWithVersionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-tuple-add-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    testConfigPath = join(testConfigDir, "opencode.json")

    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
    getPluginNameWithVersionSpy = spyOn(pluginNameWithVersion, "getPluginNameWithVersion").mockResolvedValue("oh-my-openagent")
  })

  afterEach(() => {
    getPluginNameWithVersionSpy.mockRestore()
    rmSync(testConfigDir, { recursive: true, force: true })
    resetConfigContext()
    delete process.env.OPENCODE_CONFIG_DIR
  })

  it("preserves a tuple entry when adding omo to a json config", async () => {
    // given
    const tuple = ["@plannotator/opencode@latest", { workflow: "plan-agent" }]
    writeFileSync(testConfigPath, JSON.stringify({ plugin: [tuple] }, null, 2) + "\n", "utf-8")

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedConfig = JSON.parse(readFileSync(testConfigPath, "utf-8"))
    expect(savedConfig.plugin).toEqual([tuple, "oh-my-openagent"])
  })

  it("preserves a tuple entry when adding omo to a jsonc config", async () => {
    // given - jsonc with a tuple entry; the jsonc rewriter previously
    // template-stringified the tuple into `"name,[object Object]"`.
    testConfigPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(
      testConfigPath,
      '{\n  "plugin": [\n    ["@plannotator/opencode@latest", { "workflow": "plan-agent" }]\n  ]\n}\n',
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedContent = readFileSync(testConfigPath, "utf-8")
    // tuple must survive as a JSON array, not be template-stringified to "name,[object Object]"
    expect(savedContent.includes("[object Object]")).toBe(false)
    expect(savedContent.includes('"oh-my-openagent"')).toBe(true)
    // re-parse to confirm structural correctness (JSON.stringify emits compact tuples)
    const savedConfig = JSON.parse(savedContent)
    expect(savedConfig.plugin[0]).toEqual(["@plannotator/opencode@latest", { workflow: "plan-agent" }])
    expect(savedConfig.plugin[1]).toBe("oh-my-openagent")
  })

  it("finds the real plugin array when `plugin:` appears in a comment before it (#6555 scanner)", async () => {
    // given - jsonc where a line comment contains the literal `plugin:` text
    // before the real array. Without the `(?=\[)` header anchor, the scanner
    // matched the comment's `plugin:`, failed the bracket check, returned
    // null, and the else branch inserted a duplicate `plugin` key while
    // leaving the real array (with the tuple) untouched.
    testConfigPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(
      testConfigPath,
      [
        "{",
        "  // plugin: managed by oh-my-openagent",
        '  /* block comment with plugin: text too */',
        '  "$schema": "https://opencode.ai/config.json",',
        '  "plugin": [',
        '    ["@plannotator/opencode@latest", { "workflow": "plan-agent" }],',
        "    // inner line comment inside the array",
        "    /* inner block comment */",
        '    "opencode-pty"',
        "  ]",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedContent = readFileSync(testConfigPath, "utf-8")
    // exactly one plugin key (no duplicate inserted by the else branch)
    expect((savedContent.match(/"plugin"\s*:/g) ?? []).length).toBe(1)
    // tuple survived as a JSON array
    expect(savedContent.includes("[object Object]")).toBe(false)
    expect(savedContent.includes('"oh-my-openagent"')).toBe(true)
    // re-parse via the jsonc parser (output retains header comments) to
    // confirm structure: tuple + original string entry + omo entry
    const savedConfig = parseJsonc<Record<string, unknown>>(savedContent)
    const savedPlugin = savedConfig.plugin as unknown[]
    expect(savedPlugin[0]).toEqual(["@plannotator/opencode@latest", { workflow: "plan-agent" }])
    expect(savedPlugin[1]).toBe("opencode-pty")
    expect(savedPlugin[2]).toBe("oh-my-openagent")
  })

  it("targets the root plugin array, not a nested plugin key (#6555 P1)", async () => {
    // given - jsonc where a nested object carries a `plugin` key before the
    // root plugin array. The first-match scanner previously rewrote the
    // nested array and left the root array (the active one) unchanged,
    // reporting success while omo was never registered. The depth-aware
    // scanner must skip the nested header and update the root array only.
    testConfigPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(
      testConfigPath,
      [
        "{",
        '  "mcp": {',
        '    "custom-server": { "plugin": ["nested-should-be-untouched"] }',
        "  },",
        '  "plugin": ["opencode-pty"]',
        "}",
        "",
      ].join("\n"),
      "utf-8",
    )

    // when
    const result = await addPluginToOpenCodeConfig("3.11.0")

    // then
    expect(result.success).toBe(true)
    const savedContent = readFileSync(testConfigPath, "utf-8")
    // the nested plugin array is preserved verbatim (not rewritten)
    expect(savedContent.includes('"nested-should-be-untouched"')).toBe(true)
    // the root plugin array now contains omo
    expect(savedContent.includes('"oh-my-openagent"')).toBe(true)
    const savedConfig = parseJsonc<Record<string, unknown>>(savedContent)
    const rootPlugin = savedConfig.plugin as unknown[]
    expect(rootPlugin).toEqual(["opencode-pty", "oh-my-openagent"])
    // the nested server's plugin array is untouched
    const mcp = savedConfig.mcp as Record<string, Record<string, unknown>>
    const nestedServer = mcp["custom-server"]
    expect(nestedServer.plugin).toEqual(["nested-should-be-untouched"])
  })
})
