// Parity pins for the `omo doctor` dispatch of the real npm launcher (#14959): every mode run as a
// child process of the copied launcher, stdout, stderr and exit code, written before the diagnostics
// move and kept unmodified through it. The install has no staged runtime bundles, so the reason a
// section is unavailable is the JavaScript runtime's own module-loading message; only that tail is
// masked, every other byte is pinned.
import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import { createInstall, type Install, normalize } from "./doctor-golden.test-support"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const UNAVAILABLE = /^(WARN [^:]+: diagnostics unavailable|FAIL models): .*$/gm

function omo(install: Install, args: string[]) {
  const result = spawnSync(process.execPath, [install.launcher, "doctor", ...args], {
    encoding: "utf8",
    env: {
      PATH: install.emptyBin,
      HOME: install.home,
      USERPROFILE: install.home,
      OMO_CODING_AGENT_DIR: install.agentDir,
      OMO_MEMORY_HOME: install.memory,
      HTTPS_PROXY: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
      SYSTEMROOT: process.env.SYSTEMROOT,
    },
  })
  const text = (value: string) => normalize(value, install.root).replace(UNAVAILABLE, "$1: <runtime message>").trimEnd()
  return { stdout: text(result.stdout), stderr: text(result.stderr), exitCode: result.status }
}

describe("omo doctor golden (npm launcher, child process)", () => {
  test("#given an install without staged runtimes #when doctor runs #then the report, the preparation warnings and exit code 0 are exactly today's", () => {
    const unprepared =
      "omo: could not prepare the installed engine (omo-ai: rpc_patch_target_missing: dist/modes/rpc/rpc-mode.js); reinstall with: npm i -g omo-ai@beta"
    expect(omo(createInstall(roots), [])).toEqual({
      stdout: [
        "PASS plugin manifest: plugin/package.json",
        "PASS extension: plugin/extensions/omo.js",
        "PASS lsp-daemon runtime: plugin/runtime/lsp-daemon/dist/cli.js",
        "PASS senpi CLI: <ROOT>/app/node_modules/@code-yeongyu/senpi/dist/cli.js",
        "PASS senpi version 2026.8.9",
        "INFO omo · Edition: Native · Installed: 1.2.3-test.0 (engine: senpi 2026.8.9) · Latest: could not check",
        "INFO Update: npm i -g omo-ai@beta",
        "WARN config: diagnostics unavailable: <runtime message>",
        "INFO config dir: <ROOT>/home/.omo/agent",
        // macOS only: the install carries no signed keychain helper (keychain-helper-doctor.js).
        ...(process.platform === "darwin"
          ? [
              "WARN keychain helper: missing bin/darwin/omo-keychain; macOS sign-in uses the previous keychain path and may ask for access again. Reinstall omo.",
            ]
          : []),
        "INFO Daemon: not running",
        "INFO Hosts: engine too old to enumerate",
        "WARN computer use: diagnostics unavailable: <runtime message>",
      ].join("\n"),
      stderr: [unprepared, unprepared].join("\n"),
      exitCode: 0,
    })
  })

  test("#given --models without a staged runtime #when doctor runs #then one FAIL line and exit code 1", () => {
    const install = createInstall(roots)
    const expected = { stdout: "FAIL models: <runtime message>", stderr: "", exitCode: 1 }
    expect([omo(install, ["--models"]), omo(install, ["--models", "--json"])]).toEqual([expected, expected])
  })

  test("#given --models with an unknown option #when doctor runs #then the usage goes to stderr with exit code 2", () => {
    expect(omo(createInstall(roots), ["--models", "--all"])).toEqual({
      stdout: "",
      stderr: "omo doctor --models: unknown option --all (accepted: --json)",
      exitCode: 2,
    })
  })

  test("#given no memory #when --fix and --fix --dry-run run #then each prints its nothing-to-do line with exit code 0", () => {
    const install = createInstall(roots)
    expect([omo(install, ["--fix", "--dry-run"]), omo(install, ["--fix"])]).toEqual([
      { stdout: "INFO nothing to fix", stderr: "", exitCode: 0 },
      { stdout: "PASS no stale reflection locks", stderr: "", exitCode: 0 },
    ])
  })

  test("#given --fix with an extra argument #when doctor runs #then it refuses before any sweep with exit code 1", () => {
    expect(omo(createInstall(roots), ["--fix", "--dry-run", "--all"])).toEqual({
      stdout: 'FAIL unknown argument "--all": omo doctor --fix [--dry-run]',
      stderr: "",
      exitCode: 1,
    })
  })

  test("#given --reap without pids, with a non-pid and with a pid that is no engine #when doctor runs #then each refuses with exit code 1", () => {
    const install = createInstall(roots)
    expect([omo(install, ["--reap"]), omo(install, ["--reap", "abc", "1"])]).toEqual([
      { stdout: "FAIL --reap needs the pids to terminate: omo doctor --reap <pid> [pid...]", stderr: "", exitCode: 1 },
      {
        stdout: [
          'FAIL refusing "abc": --reap takes process ids',
          "FAIL refusing pid 1: it is not an omo engine process",
        ].join("\n"),
        stderr: "",
        exitCode: 1,
      },
    ])
  })
})
