import { describe, expect, test } from "bun:test"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const AGENT_DIR = join(import.meta.dir, "agent")
const REPO_ROOT = join(import.meta.dir, "..")
const posixBashTest = test.skipIf(process.platform === "win32")

function read(path: string): string {
  return readFileSync(path, "utf8")
}

function isExecutable(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0
}

function toBashPath(path: string): string {
  if (process.platform !== "win32") {
    return path
  }

  const normalized = path.replaceAll("\\", "/")
  const drivePath = normalized.match(/^([A-Za-z]):(\/.*)$/)
  if (drivePath === null) {
    return normalized
  }

  const drive = drivePath[1]
  const rest = drivePath[2]
  if (drive === undefined || rest === undefined) {
    return normalized
  }
  return `/${drive.toLowerCase()}${rest}`
}

function createCleanupHookFixture(workerBody: string): { readonly repo: string; readonly agentDir: string; readonly logDir: string } {
  const repo = mkdtempSync(join(tmpdir(), "omo-cleanup-hook-test-"))
  const agentDir = join(repo, "script", "agent")
  const logDir = mkdtempSync(join(tmpdir(), "omo-cleanup-hook-log-"))
  mkdirSync(agentDir, { recursive: true })
  copyFileSync(join(AGENT_DIR, "cleanup-hook.sh"), join(agentDir, "cleanup-hook.sh"))
  writeFileSync(join(agentDir, "cleanup.sh"), workerBody)
  chmodSync(join(agentDir, "cleanup-hook.sh"), 0o755)
  chmodSync(join(agentDir, "cleanup.sh"), 0o755)
  return { repo, agentDir, logDir }
}

describe("agent dev-environment scripts", () => {
  describe("setup.sh", () => {
    const setup = join(AGENT_DIR, "setup.sh")

    test("#given the shared bootstrap #when inspected #then it is an executable strict bash script", () => {
      // given / when / then
      expect(existsSync(setup), "script/agent/setup.sh must exist").toBe(true)
      if (process.platform !== "win32") {
        expect(isExecutable(setup), "setup.sh must be executable").toBe(true)
      }
      const body = read(setup)
      expect(body.startsWith("#!/usr/bin/env bash")).toBe(true)
      expect(body).toContain("set -euo pipefail")
    })

    test("#given the bootstrap #when it runs #then it verifies tools, installs, and conditionally builds", () => {
      // given
      const body = read(join(AGENT_DIR, "setup.sh"))

      // then
      expect(body).toContain("command -v") // tool presence check
      expect(body).toContain("bun node git") // required toolchain verified
      expect(body).toContain("tmux") // non-fatal warning path
      expect(body).toContain("bun install")
      expect(body).toContain("bun run build")
      expect(body).toContain("OMO_AGENT_FORCE_BUILD") // idempotent skip-build guard
      expect(body).toContain(".env") // credential sourcing
      expect(body).toContain("--ignore-scripts")
      expect(body).toContain("1.3.12")
    })
  })

  describe("cleanup.sh", () => {
    const cleanup = join(AGENT_DIR, "cleanup.sh")
    const cleanupHook = join(AGENT_DIR, "cleanup-hook.sh")

    test("#given the teardown #when inspected #then it is an executable strict bash script with a --deep mode", () => {
      // given / when / then
      expect(existsSync(cleanup), "script/agent/cleanup.sh must exist").toBe(true)
      if (process.platform !== "win32") {
        expect(isExecutable(cleanup), "cleanup.sh must be executable").toBe(true)
      }
      const body = read(cleanup)
      expect(body.startsWith("#!/usr/bin/env bash")).toBe(true)
      expect(body).toContain("set -euo pipefail")
      expect(body).toContain("--deep")
    })

    test("#given the Claude SessionEnd launcher #when inspected #then it is executable bash", () => {
      // given / when / then
      expect(existsSync(cleanupHook), "script/agent/cleanup-hook.sh must exist").toBe(true)
      if (process.platform !== "win32") {
        expect(isExecutable(cleanupHook), "cleanup-hook.sh must be executable").toBe(true)
      }
      const body = read(cleanupHook)
      expect(body.startsWith("#!/usr/bin/env bash")).toBe(true)
    })

    posixBashTest("#given the Claude SessionEnd launcher #when sync mode runs #then it executes cleanup and exits successfully", () => {
      // given
      const fixture = createCleanupHookFixture(`#!/usr/bin/env bash
printf 'worker-ran\\n' > "$CLAUDE_PROJECT_DIR/worker.marker"
printf 'worker-log\\n'
`)

      try {
        // when
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup-hook.sh"],
          cwd: fixture.agentDir,
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: toBashPath(fixture.repo),
            OMO_AGENT_CLEANUP_SYNC: "1",
            TMPDIR: toBashPath(fixture.logDir),
          },
          stdout: "pipe",
          stderr: "pipe",
        })

        // then
        expect(result.exitCode).toBe(0)
        expect(read(join(fixture.repo, "worker.marker"))).toBe("worker-ran\n")
        expect(read(join(fixture.logDir, "oh-my-openagent-cleanup.log"))).toContain("worker-log")
      } finally {
        rmSync(fixture.repo, { recursive: true, force: true })
        rmSync(fixture.logDir, { recursive: true, force: true })
      }
    })

    posixBashTest("#given the Claude SessionEnd launcher #when async mode runs #then it returns before cleanup finishes", async () => {
      // given
      const fixture = createCleanupHookFixture(`#!/usr/bin/env bash
printf 'worker-started\\n'
sleep 1
printf 'worker-finished\\n' > "$CLAUDE_PROJECT_DIR/worker.marker"
`)

      try {
        // when
        const startedAt = performance.now()
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup-hook.sh"],
          cwd: fixture.agentDir,
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: toBashPath(fixture.repo),
            TMPDIR: toBashPath(fixture.logDir),
          },
          stdout: "pipe",
          stderr: "pipe",
        })
        const elapsedMs = performance.now() - startedAt

        // then
        expect(result.exitCode).toBe(0)
        expect(elapsedMs).toBeLessThan(500)
        expect(existsSync(join(fixture.repo, "worker.marker"))).toBe(false)

        for (let attempt = 0; attempt < 30 && !existsSync(join(fixture.repo, "worker.marker")); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        expect(read(join(fixture.repo, "worker.marker"))).toBe("worker-finished\n")
        expect(read(join(fixture.logDir, "oh-my-openagent-cleanup.log"))).toContain("worker-started")
      } finally {
        rmSync(fixture.repo, { recursive: true, force: true })
        rmSync(fixture.logDir, { recursive: true, force: true })
      }
    })

    posixBashTest("#given a hostile cleanup log override #when the launcher runs #then it keeps logs in temp", () => {
      // given
      const fixture = createCleanupHookFixture(`#!/usr/bin/env bash
printf 'safe-log\\n'
`)
      const hostileLog = join(fixture.repo, "host-config.toml")
      writeFileSync(hostileLog, "preserve-me\n")

      try {
        // when
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup-hook.sh"],
          cwd: fixture.agentDir,
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: toBashPath(fixture.repo),
            OMO_AGENT_CLEANUP_LOG: toBashPath(hostileLog),
            OMO_AGENT_CLEANUP_SYNC: "1",
            TMPDIR: toBashPath(fixture.logDir),
          },
          stdout: "pipe",
          stderr: "pipe",
        })

        // then
        expect(result.exitCode).toBe(0)
        expect(read(hostileLog)).toBe("preserve-me\n")
        expect(read(join(fixture.logDir, "oh-my-openagent-cleanup.log"))).toContain("safe-log")
      } finally {
        rmSync(fixture.repo, { recursive: true, force: true })
        rmSync(fixture.logDir, { recursive: true, force: true })
      }
    })

    test("#given the teardown #when inspected for safety #then it guards repo root and never nukes source or host", () => {
      // given
      const body = read(join(AGENT_DIR, "cleanup.sh"))

      // then
      expect(body).toContain("oh-my-openagent") // package-name repo-root guard
      const dangerous = ["rm -rf /", "rm -rf ~", "rm -rf $HOME", "rm -rf src", "rm -rf packages"]
      for (const pattern of dangerous) {
        expect(body, `cleanup must never contain '${pattern}'`).not.toContain(pattern)
      }
    })

    posixBashTest("#given transient files in source and skipped trees #when cleanup runs #then it prunes skipped trees", () => {
      // given
      const repo = mkdtempSync(join(tmpdir(), "omo-cleanup-test-"))
      const tmpAgentDir = join(repo, "script", "agent")
      mkdirSync(tmpAgentDir, { recursive: true })
      mkdirSync(join(repo, "src"), { recursive: true })
      mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true })
      mkdirSync(join(repo, ".git", "objects"), { recursive: true })
      copyFileSync(cleanup, join(tmpAgentDir, "cleanup.sh"))
      writeFileSync(join(repo, "package.json"), '{ "name": "oh-my-openagent" }\n')
      writeFileSync(join(repo, "src", "app.tsbuildinfo"), "source transient")
      writeFileSync(join(repo, "src", ".DS_Store"), "source os transient")
      writeFileSync(join(repo, "node_modules", "pkg", "cache.tsbuildinfo"), "dependency cache")
      writeFileSync(join(repo, ".git", "objects", "cache.tsbuildinfo"), "git cache")

      try {
        // when
        const result = Bun.spawnSync({
          cmd: ["bash", "./cleanup.sh"],
          cwd: tmpAgentDir,
          stdout: "pipe",
          stderr: "pipe",
        })

        // then
        expect(result.exitCode).toBe(0)
        expect(existsSync(join(repo, "src", "app.tsbuildinfo"))).toBe(false)
        expect(existsSync(join(repo, "src", ".DS_Store"))).toBe(false)
        expect(existsSync(join(repo, "node_modules", "pkg", "cache.tsbuildinfo"))).toBe(true)
        expect(existsSync(join(repo, ".git", "objects", "cache.tsbuildinfo"))).toBe(true)
      } finally {
        rmSync(repo, { recursive: true, force: true })
      }
    })
  })

  describe("qa-sandbox.sh", () => {
    const sandbox = join(AGENT_DIR, "qa-sandbox.sh")

    test("#given the QA isolation helper #when inspected #then it isolates XDG + CODEX_HOME and injects creds", () => {
      // given / when / then
      expect(existsSync(sandbox), "script/agent/qa-sandbox.sh must exist").toBe(true)
      const body = read(sandbox)
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
      // given
      const example = join(REPO_ROOT, ".env.example")

      // when / then
      expect(existsSync(example), ".env.example must exist (committed injection point)").toBe(true)
      const body = read(example)
      expect(body).toContain("ANTHROPIC_API_KEY")
      expect(body).toContain("OPENAI_API_KEY")
      expect(body).toContain("#") // documented with comments
      expect(body).toContain("# ANTHROPIC_API_KEY")
    })
  })
})
