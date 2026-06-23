import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveClaudeMemLlmAdapterConfig } from "./config"

describe("resolveClaudeMemLlmAdapterConfig", () => {
  const tempRoots: string[] = []
  function makeConfigDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "claude-mem-cfg-"))
    tempRoots.push(dir)
    return dir
  }
  function makeConfigPath(content: object, apiKey: string | null): string {
    const dir = makeConfigDir()
    let body: Record<string, unknown> = { ...content }
    if (apiKey !== null) {
      const keyPath = join(dir, "opencode-go.key")
      writeFileSync(keyPath, apiKey)
      body = { apiKeyFile: keyPath, ...body }
    }
    const path = join(dir, "opencode-go-config.json")
    writeFileSync(path, JSON.stringify(body))
    return path
  }

  afterEach(() => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop()
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  })

  describe("#given env CLAUDE_MEM_OPENCODE_GO_API_KEY only and no config file", () => {
    it("#when resolving #then defaults are applied", () => {
      const cfg = resolveClaudeMemLlmAdapterConfig(
        { CLAUDE_MEM_OPENCODE_GO_API_KEY: "sk-env" },
        join(tmpdir(), "non-existent-config.json"),
      )
      expect(cfg.apiKey).toBe("sk-env")
      expect(cfg.endpoint).toBe("http://127.0.0.1:20128/v1/chat/completions")
      expect(cfg.primaryModel).toBe("deepseek-v4-flash")
      expect(cfg.fallbackModel).toBe("deepseek-v4-flash")
    })
  })

  describe("#given config file with endpoint and models", () => {
    it("#when env has no overrides #then file values win", () => {
      const path = makeConfigPath(
        {
          endpoint: "https://example.test/zen/go/v1/chat/completions",
          model: "kimi-k2.5",
          fallbackModel: "minimax-m3",
        },
        "sk-file",
      )
      const cfg = resolveClaudeMemLlmAdapterConfig({}, path)
      expect(cfg.endpoint).toBe("https://example.test/zen/go/v1/chat/completions")
      expect(cfg.primaryModel).toBe("kimi-k2.5")
      expect(cfg.fallbackModel).toBe("minimax-m3")
      expect(cfg.apiKey).toBe("sk-file")
    })
  })

  describe("#given env overrides for endpoint and model", () => {
    it("#when both file and env present #then env wins", () => {
      const path = makeConfigPath(
        { endpoint: "https://file.test/v1/chat/completions", model: "file-model" },
        "sk-file",
      )
      const cfg = resolveClaudeMemLlmAdapterConfig(
        {
          CLAUDE_MEM_OPENCODE_GO_ENDPOINT: "https://env.test/v1/chat/completions",
          CLAUDE_MEM_OPENCODE_GO_MODEL: "env-model",
          CLAUDE_MEM_OPENCODE_GO_API_KEY: "sk-env",
        },
        path,
      )
      expect(cfg.endpoint).toBe("https://env.test/v1/chat/completions")
      expect(cfg.primaryModel).toBe("env-model")
      expect(cfg.apiKey).toBe("sk-env")
    })
  })

  describe("#given malformed config file", () => {
    it("#when resolving #then falls back to env without throwing", () => {
      const dir = makeConfigDir()
      const path = join(dir, "opencode-go-config.json")
      writeFileSync(path, "{not-valid-json")
      const cfg = resolveClaudeMemLlmAdapterConfig(
        { CLAUDE_MEM_OPENCODE_GO_API_KEY: "sk-after-malformed" },
        path,
      )
      expect(cfg.apiKey).toBe("sk-after-malformed")
      expect(cfg.endpoint).toBe("http://127.0.0.1:20128/v1/chat/completions")
    })
  })

  describe("#given neither env API key nor key file", () => {
    it("#when resolving #then throws explanatory error", () => {
      expect(() =>
        resolveClaudeMemLlmAdapterConfig(
          { CLAUDE_MEM_OPENCODE_GO_API_KEY_FILE: join(tmpdir(), "absent-claude-mem-key.key") },
          join(tmpdir(), "absent-config.json"),
        ),
      ).toThrow(/required for claude-mem adapter/)
    })
  })

  describe("#given config file with apiKeyFile pointing to a key", () => {
    it("#when env has no API key #then key is read from file", () => {
      const path = makeConfigPath({}, "sk-from-file")
      const cfg = resolveClaudeMemLlmAdapterConfig({}, path)
      expect(cfg.apiKey).toBe("sk-from-file")
    })
  })
})
