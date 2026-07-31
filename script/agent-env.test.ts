import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const AGENT_DIR = join(import.meta.dir, "agent")
const REPO_ROOT = join(import.meta.dir, "..")

describe("agent dev-environment scripts", () => {
  describe("setup.sh", () => {
    const setup = join(AGENT_DIR, "setup.sh")

    test("#given the shared bootstrap #when inspected #then it is an executable strict bash script", () => {
      expect(existsSync(setup), "script/agent/setup.sh must exist").toBe(true)
      if (process.platform !== "win32") {
        expect((statSync(setup).mode & 0o111) !== 0, "setup.sh must be executable").toBe(true)
      }
      const body = readFileSync(setup, "utf8")
      expect(body.startsWith("#!/usr/bin/env bash")).toBe(true)
      expect(body).toContain("set -euo pipefail")
    })

    test("#given the bootstrap #when it runs #then it verifies tools, installs, and conditionally builds", () => {
      const body = readFileSync(setup, "utf8")

      expect(body).toContain("command -v") // tool presence check
      expect(body).toContain("bun node git") // required toolchain verified
      expect(body).toContain("tmux") // non-fatal warning path
      expect(body).toContain("bun install")
      expect(body).toContain("bun run build")
      expect(body).toContain("OMO_AGENT_FORCE_BUILD") // idempotent skip-build guard
      expect(body).toContain(".env") // credential sourcing
      expect(body).toContain("--ignore-scripts")
      expect(body).toContain("1.3.12")
      expect(body).toContain("submodule update --init") // provenance submodules
      expect(body).toContain("materialize-frontend-refs") // frontend ref materialize
    })
  })

  describe("qa-sandbox.sh", () => {
    const sandbox = join(AGENT_DIR, "qa-sandbox.sh")

    test("#given the QA isolation helper #when inspected #then it isolates XDG + CODEX_HOME and injects creds", () => {
      expect(existsSync(sandbox), "script/agent/qa-sandbox.sh must exist").toBe(true)
      const body = readFileSync(sandbox, "utf8")
      expect(body.startsWith("#!/usr/bin/env bash")).toBe(true)
      expect(body).toContain("mktemp")
      for (const xdg of ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
        expect(body, `must isolate ${xdg}`).toContain(xdg)
      }
      expect(body).toContain("CODEX_HOME")
      expect(body).toContain("OPENCODE_DISABLE_AUTOUPDATE")
      expect(body).toContain("OPENCODE_DISABLE_MODELS_FETCH")
      expect(body).toContain(".env") // creds injection, set once
      expect(body).toContain(":-$0")
    })
  })

  describe(".env.example", () => {
    test("#given the credential template #when inspected #then it documents the injection points without real secrets", () => {
      const example = join(REPO_ROOT, ".env.example")

      expect(existsSync(example), ".env.example must exist (committed injection point)").toBe(true)
      const body = readFileSync(example, "utf8")
      expect(body).toContain("ANTHROPIC_API_KEY")
      expect(body).toContain("OPENAI_API_KEY")
      expect(body).toContain("#") // documented with comments
      expect(body).toContain("# ANTHROPIC_API_KEY")
    })
  })
})
