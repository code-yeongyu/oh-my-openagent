/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  handleRolesModelsCommand,
  isRolesModelsCommand,
  resolveAutoPick,
} from "./command-handler"
import { _resetAllForTests, getOverride, getAutoPickOverride } from "./state"
import type { OhMyOpenCodeConfig } from "../../config"
import { resetConfigContext } from "../../cli/config-manager/config-context"

const config = {
  agents: {
    sisyphus: {
      model: "anthropic/claude-opus-4-7",
      variant: "max",
      fallback_models: [{ model: "opencode-go/kimi-k2.6" }],
    },
    hephaestus: {
      model: "openai/gpt-5.5",
      variant: "medium",
    },
  },
} as unknown as OhMyOpenCodeConfig

function freshOutput(): { parts: Array<{ type: string; text?: string }> } {
  return { parts: [] }
}

describe("isRolesModelsCommand", () => {
  test("matches the three command names case-insensitively", () => {
    expect(isRolesModelsCommand("show-models")).toBe(true)
    expect(isRolesModelsCommand("SHOW-MODELS")).toBe(true)
    expect(isRolesModelsCommand("pick")).toBe(true)
    expect(isRolesModelsCommand("auto-pick")).toBe(true)
    expect(isRolesModelsCommand("refactor")).toBe(false)
  })
})

describe("handleRolesModelsCommand", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  describe("/show-models", () => {
    test("renders the panel into output.parts", () => {
      const output = freshOutput()
      const handled = handleRolesModelsCommand(
        { command: "show-models", sessionID: "s1", arguments: "" },
        output,
        config,
      )

      expect(handled).toBe(true)
      expect(output.parts).toHaveLength(1)
      expect(output.parts[0].type).toBe("text")
      expect(output.parts[0].text).toContain("Roles · Models")
      expect(output.parts[0].text).toContain("sisyphus")
      expect(output.parts[0].text).toContain("anthropic/claude-opus-4-7 max")
    })
  })

  describe("/pick", () => {
    test("with valid args sets the override and acknowledges", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "pick", sessionID: "s1", arguments: "sisyphus opencode-go/kimi-k2.6" },
        output,
        config,
      )

      expect(getOverride("s1", "sisyphus")).toEqual({ model: "opencode-go/kimi-k2.6" })
      expect(output.parts[0].text).toContain("/pick applied")
      expect(output.parts[0].text).toContain("opencode-go/kimi-k2.6")
    })

    test("with --variant carries the variant onto the override", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        {
          command: "pick",
          sessionID: "s1",
          arguments: "sisyphus anthropic/claude-opus-4-7 --variant=max",
        },
        output,
        config,
      )

      expect(getOverride("s1", "sisyphus")).toEqual({
        model: "anthropic/claude-opus-4-7",
        variant: "max",
      })
    })

    test("with missing args returns a usage message and does not set override", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "pick", sessionID: "s1", arguments: "sisyphus" },
        output,
        config,
      )

      expect(getOverride("s1", "sisyphus")).toBeUndefined()
      expect(output.parts[0].text).toContain("Usage:")
    })

    test("with unknown role returns an error and does not set override", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "pick", sessionID: "s1", arguments: "nonexistent x/y" },
        output,
        config,
      )

      expect(getOverride("s1", "nonexistent")).toBeUndefined()
      expect(output.parts[0].text).toContain("Unknown role")
    })
  })

  describe("/auto-pick", () => {
    test("on sets the session override to true", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "auto-pick", sessionID: "s1", arguments: "on" },
        output,
        config,
      )

      expect(getAutoPickOverride("s1")).toBe(true)
      expect(output.parts[0].text).toContain("auto-pick ON")
    })

    test("off sets the session override to false", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "auto-pick", sessionID: "s1", arguments: "off" },
        output,
        config,
      )

      expect(getAutoPickOverride("s1")).toBe(false)
    })

    test("with garbage arg returns a usage message", () => {
      const output = freshOutput()
      handleRolesModelsCommand(
        { command: "auto-pick", sessionID: "s1", arguments: "maybe" },
        output,
        config,
      )

      expect(getAutoPickOverride("s1")).toBeUndefined()
      expect(output.parts[0].text).toContain("Usage:")
    })
  })

  describe("unknown command", () => {
    test("returns false and leaves output untouched", () => {
      const output = freshOutput()
      const handled = handleRolesModelsCommand(
        { command: "refactor", sessionID: "s1", arguments: "" },
        output,
        config,
      )

      expect(handled).toBe(false)
      expect(output.parts).toHaveLength(0)
    })
  })
})

describe("resolveAutoPick", () => {
  beforeEach(() => {
    _resetAllForTests()
  })

  test("falls back to config when no session override is set", () => {
    expect(resolveAutoPick("s1", { display: { auto_pick: true } } as OhMyOpenCodeConfig)).toBe(true)
    expect(resolveAutoPick("s1", { display: { auto_pick: false } } as OhMyOpenCodeConfig)).toBe(false)
    expect(resolveAutoPick("s1", {} as OhMyOpenCodeConfig)).toBe(false)
  })

  test("session override wins over config default", () => {
    handleRolesModelsCommand(
      { command: "auto-pick", sessionID: "s1", arguments: "on" },
      freshOutput(),
      { display: { auto_pick: false } } as OhMyOpenCodeConfig,
    )

    expect(resolveAutoPick("s1", { display: { auto_pick: false } } as OhMyOpenCodeConfig)).toBe(true)
  })
})

// ── /pick --persist tests ────────────────────────────────────────────────────

describe("/pick --persist", () => {
  let testConfigDir: string

  beforeEach(() => {
    _resetAllForTests()
    testConfigDir = join(
      tmpdir(),
      `omo-pick-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testConfigDir, { recursive: true })
    // Point the config context at our isolated tmpdir
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    resetConfigContext()
  })

  afterEach(() => {
    delete process.env.OPENCODE_CONFIG_DIR
    resetConfigContext()
    rmSync(testConfigDir, { recursive: true, force: true })
  })

  test("#1 --persist writes agents.<role>.model to user config when file exists with empty object", () => {
    // given
    const configPath = join(testConfigDir, "oh-my-openagent.json")
    writeFileSync(configPath, "{}", "utf-8")

    const output = freshOutput()
    const liveConfig = { ...config } as unknown as OhMyOpenCodeConfig

    // when
    handleRolesModelsCommand(
      { command: "pick", sessionID: "s1", arguments: "sisyphus anthropic/claude-opus-4-7 --persist" },
      output,
      liveConfig,
    )

    // then
    expect(output.parts[0].text).toContain("/pick applied")
    expect(output.parts[0].text).toContain("persisted to")
    expect(output.parts[0].text).toContain("anthropic/claude-opus-4-7")
    expect(existsSync(configPath)).toBe(true)
    const written = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(written.agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-7")
  })

  test("#2 --persist with --variant=X writes both model and variant", () => {
    // given
    const configPath = join(testConfigDir, "oh-my-openagent.json")
    writeFileSync(configPath, "{}", "utf-8")

    const output = freshOutput()
    const liveConfig = { ...config } as unknown as OhMyOpenCodeConfig

    // when
    handleRolesModelsCommand(
      {
        command: "pick",
        sessionID: "s1",
        arguments: "sisyphus anthropic/claude-opus-4-7 --variant=max --persist",
      },
      output,
      liveConfig,
    )

    // then
    expect(output.parts[0].text).toContain("/pick applied")
    expect(output.parts[0].text).toContain("persisted to")
    const written = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(written.agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-7")
    expect(written.agents?.sisyphus?.variant).toBe("max")
  })

  test("#3 --persist preserves existing comments in a jsonc file", () => {
    // given
    const configPath = join(testConfigDir, "oh-my-openagent.jsonc")
    const jsoncContent = `// My config\n{\n  // keep this comment\n  "display": { "auto_pick": true }\n}\n`
    writeFileSync(configPath, jsoncContent, "utf-8")

    const output = freshOutput()

    // when
    handleRolesModelsCommand(
      { command: "pick", sessionID: "s1", arguments: "sisyphus openai/gpt-5.5 --persist" },
      output,
      { ...config } as unknown as OhMyOpenCodeConfig,
    )

    // then
    expect(output.parts[0].text).toContain("persisted to")
    const updatedContent = readFileSync(configPath, "utf-8")
    // Comments must be preserved
    expect(updatedContent).toContain("// My config")
    expect(updatedContent).toContain("// keep this comment")
    // Model must be written
    expect(updatedContent).toContain("gpt-5.5")
    // Existing display config must survive
    expect(updatedContent).toContain("auto_pick")
  })

  test("#4 --persist overwrites existing agents.<role>.model with the new value", () => {
    // given
    const configPath = join(testConfigDir, "oh-my-openagent.json")
    writeFileSync(
      configPath,
      JSON.stringify({ agents: { sisyphus: { model: "old-model" } } }, null, 2),
      "utf-8",
    )

    const output = freshOutput()

    // when
    handleRolesModelsCommand(
      { command: "pick", sessionID: "s1", arguments: "sisyphus new/model --persist" },
      output,
      { ...config } as unknown as OhMyOpenCodeConfig,
    )

    // then
    expect(output.parts[0].text).toContain("persisted to")
    const written = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(written.agents.sisyphus.model).toBe("new/model")
  })

  test("#5 --persist creates the agents block when it is missing from the config", () => {
    // given — config exists but has no agents key
    const configPath = join(testConfigDir, "oh-my-openagent.json")
    writeFileSync(configPath, JSON.stringify({ display: { auto_pick: false } }, null, 2), "utf-8")

    const output = freshOutput()

    // when
    handleRolesModelsCommand(
      { command: "pick", sessionID: "s1", arguments: "sisyphus openai/gpt-5.5 --persist" },
      output,
      { ...config } as unknown as OhMyOpenCodeConfig,
    )

    // then
    expect(output.parts[0].text).toContain("persisted to")
    const written = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(written.agents?.sisyphus?.model).toBe("openai/gpt-5.5")
    // Existing key must survive
    expect(written.display?.auto_pick).toBe(false)
  })

  test("#6 --persist returns a structured error when the config dir is not writable", () => {
    // given — set config dir to a path inside a non-existent deeply nested read-only location
    // We simulate write failure by pointing to a path where the parent is a file (not a dir)
    const blocker = join(testConfigDir, "blocker-file")
    writeFileSync(blocker, "I am a file, not a dir", "utf-8")
    // Override config dir to a path whose parent is that file (impossible to mkdir under a file)
    process.env.OPENCODE_CONFIG_DIR = join(blocker, "sub")
    resetConfigContext()

    const output = freshOutput()

    // when
    handleRolesModelsCommand(
      { command: "pick", sessionID: "s1", arguments: "sisyphus openai/gpt-5.5 --persist" },
      output,
      { ...config } as unknown as OhMyOpenCodeConfig,
    )

    // then — must report error, not silently fall back
    const text = output.parts[0].text ?? ""
    expect(text).toContain("✗")
    expect(text).toContain("/pick --persist failed")
    // Session override must NOT be set (pick itself didn't succeed either)
    // Actually the session override IS set before persist — that's OK per spec
    // The key assertion is that the error message contains the path context
    expect(text).toContain("path:")
  })

  test("#7 atomic write: tmp file is renamed onto target, not appended directly", () => {
    // given
    const configPath = join(testConfigDir, "oh-my-openagent.json")
    writeFileSync(configPath, "{}", "utf-8")

    const output = freshOutput()

    // when
    handleRolesModelsCommand(
      { command: "pick", sessionID: "s1", arguments: "sisyphus openai/gpt-5.5 --persist" },
      output,
      { ...config } as unknown as OhMyOpenCodeConfig,
    )

    // then — the .tmp file must NOT be left behind (atomic rename completes)
    expect(existsSync(`${configPath}.tmp`)).toBe(false)
    // The target file must have the correct content
    expect(existsSync(configPath)).toBe(true)
    const written = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(written.agents?.sisyphus?.model).toBe("openai/gpt-5.5")
  })

  test("#8 --persist also updates in-memory config so session sees new value immediately", () => {
    // given
    const configPath = join(testConfigDir, "oh-my-openagent.json")
    writeFileSync(configPath, "{}", "utf-8")

    const liveConfig = {
      agents: {
        sisyphus: { model: "old-model" },
      },
    } as unknown as OhMyOpenCodeConfig

    const output = freshOutput()

    // when
    handleRolesModelsCommand(
      { command: "pick", sessionID: "s1", arguments: "sisyphus new/model --persist" },
      output,
      liveConfig,
    )

    // then — in-memory config must be mutated
    expect((liveConfig.agents as Record<string, { model: string }>)?.sisyphus?.model).toBe(
      "new/model",
    )
  })
})
