import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getSidecarPath, readAppliedMigrations, writeAppliedMigrations } from "./migrations-sidecar"

describe("migrations sidecar", () => {
  let workdir: string

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "omo-migrations-sidecar-"))
  })

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true })
  })

  describe("getSidecarPath", () => {
    test("appends .migrations.json to the config path", () => {
      expect(getSidecarPath("/home/user/.config/opencode/oh-my-openagent.json")).toBe(
        "/home/user/.config/opencode/oh-my-openagent.json.migrations.json",
      )
    })

    test("works for jsonc configs too", () => {
      expect(getSidecarPath("/home/user/oh-my-openagent.jsonc")).toBe(
        "/home/user/oh-my-openagent.jsonc.migrations.json",
      )
    })
  })

  describe("readAppliedMigrations", () => {
    test("returns an empty set when no sidecar exists", () => {
      const configPath = join(workdir, "oh-my-openagent.json")
      expect(readAppliedMigrations(configPath).size).toBe(0)
    })

    test("returns the applied migrations listed in a well-formed sidecar", () => {
      const configPath = join(workdir, "oh-my-openagent.json")
      writeFileSync(
        getSidecarPath(configPath),
        JSON.stringify({
          appliedMigrations: [
            "model-version:openai/gpt-5.3-codex->openai/gpt-5.4",
            "model-version:anthropic/claude-opus-4-5->anthropic/claude-opus-4-6",
          ],
        }),
      )

      const applied = readAppliedMigrations(configPath)

      expect(applied.size).toBe(2)
      expect(applied.has("model-version:openai/gpt-5.3-codex->openai/gpt-5.4")).toBe(true)
      expect(applied.has("model-version:anthropic/claude-opus-4-5->anthropic/claude-opus-4-6")).toBe(true)
    })

    test("returns an empty set on malformed JSON instead of throwing", () => {
      const configPath = join(workdir, "oh-my-openagent.json")
      writeFileSync(getSidecarPath(configPath), "{ this is not json")

      expect(readAppliedMigrations(configPath).size).toBe(0)
    })

    test("returns an empty set when the sidecar payload has the wrong shape", () => {
      const configPath = join(workdir, "oh-my-openagent.json")
      writeFileSync(getSidecarPath(configPath), JSON.stringify({ appliedMigrations: "not-an-array" }))

      expect(readAppliedMigrations(configPath).size).toBe(0)
    })

    test("ignores non-string entries inside appliedMigrations", () => {
      const configPath = join(workdir, "oh-my-openagent.json")
      writeFileSync(
        getSidecarPath(configPath),
        JSON.stringify({
          appliedMigrations: ["model-version:a->b", 42, null, "model-version:c->d"],
        }),
      )

      const applied = readAppliedMigrations(configPath)

      expect(applied.size).toBe(2)
      expect(applied.has("model-version:a->b")).toBe(true)
      expect(applied.has("model-version:c->d")).toBe(true)
    })
  })

  describe("writeAppliedMigrations", () => {
    test("creates the sidecar with the given migration keys", () => {
      const configPath = join(workdir, "oh-my-openagent.json")
      const migrations = new Set([
        "model-version:openai/gpt-5.3-codex->openai/gpt-5.4",
      ])

      const ok = writeAppliedMigrations(configPath, migrations)

      expect(ok).toBe(true)
      expect(existsSync(getSidecarPath(configPath))).toBe(true)

      const body = JSON.parse(readFileSync(getSidecarPath(configPath), "utf-8"))
      expect(body.appliedMigrations).toEqual(["model-version:openai/gpt-5.3-codex->openai/gpt-5.4"])
    })

    test("writes entries in sorted order for stable diffs", () => {
      const configPath = join(workdir, "oh-my-openagent.json")
      const migrations = new Set([
        "model-version:z->y",
        "model-version:a->b",
        "model-version:m->n",
      ])

      writeAppliedMigrations(configPath, migrations)

      const body = JSON.parse(readFileSync(getSidecarPath(configPath), "utf-8"))
      expect(body.appliedMigrations).toEqual([
        "model-version:a->b",
        "model-version:m->n",
        "model-version:z->y",
      ])
    })

    test("creates parent directories if they do not exist yet", () => {
      const nested = join(workdir, "nested", "dir", "that", "does", "not", "exist")
      const configPath = join(nested, "oh-my-openagent.json")
      // Parent chain intentionally not created.

      const ok = writeAppliedMigrations(configPath, new Set(["model-version:a->b"]))

      expect(ok).toBe(true)
      expect(existsSync(getSidecarPath(configPath))).toBe(true)
    })

    test("round-trips via readAppliedMigrations", () => {
      const configPath = join(workdir, "oh-my-openagent.jsonc")
      const original = new Set([
        "model-version:openai/gpt-5.3-codex->openai/gpt-5.4",
        "model-version:anthropic/claude-opus-4-5->anthropic/claude-opus-4-6",
      ])

      writeAppliedMigrations(configPath, original)
      const roundTripped = readAppliedMigrations(configPath)

      expect(roundTripped).toEqual(original)
    })
  })
})
