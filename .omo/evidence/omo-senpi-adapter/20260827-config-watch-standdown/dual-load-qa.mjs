#!/usr/bin/env node
// Change-scoped live QA for the config-watch duplicate-load fix (PR #7420).
// Reuses the sanctioned isolation harness from packages/omo-senpi/scripts/qa/drive.mjs:
// every lane runs the REAL senpi binary against its own throwaway SENPI_CODING_AGENT_DIR
// with the local mock provider (PI_OFFLINE=1, no real API call, no real credentials).
//
// Lanes:
//   lane1-single-load : one fixed plugin via settings packages        -> healthy session, no stand-down
//   lane2-dual-fixed  : fixed plugin via packages + fixed copy via -e -> stand-down warning, session completes
//   lane3-dual-prefix : PRE-FIX bundle in both positions              -> reproduces the reported RangeError
//
// Lane 3 is the failing-first proof: the pre-fix bundles are extracted from the
// parent of the fix commit (c45968dfc = "fix(omo-senpi): stop config-watch rebuild
// recursion under duplicate extension loads"), i.e. the origin/dev base the PR
// branched from. Override with PREFIX_REVISION if the branch is rebased.
import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const qaDir = join(repoRoot, "packages", "omo-senpi", "scripts", "qa")
const pluginRoot = join(repoRoot, "packages", "omo-senpi", "plugin")
const mockProviderEntry = join(qaDir, "mock-provider", "index.ts")
const senpiBin = process.env.SENPI_BIN?.trim() || join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "senpi.exe" : "senpi")

const { createSandbox, seedSandbox, credentialDigest } = await import(pathToFileURL(join(qaDir, "drive.mjs")).href)

const STANDDOWN = "superseded by another omo extension instance; standing down"
const RANGE_ERROR = "Maximum call stack size exceeded"
const REGISTRATION_FAILURE = "component registration failed"

// Generated extension bundles that exist as tracked build outputs; the pre-fix
// lanes overwrite ALL of them from the parent commit so the crashing extension
// is exactly what shipped there, not a mixed-generation hybrid.
const GENERATED_EXTENSION_BUNDLES = [
  "omo.js",
  "omo-task.js",
  "omo-member.js",
  "omo-memory-mcp.js",
  "memory-run-supervisor.mjs",
  "omo-init-deep-advisor.js",
]

// Full-fidelity plugin copy: the COMPLETE generated plugin tree (extensions,
// skills, staged runtime/, manifest) so every component registers, then the
// requested generation of each extension bundle is laid on top.
function makePluginCopy(targetDir, bundleOverrides) {
  mkdirSync(targetDir, { recursive: true })
  cpSync(pluginRoot, targetDir, { recursive: true })
  for (const [relName, content] of bundleOverrides) {
    writeFileSync(join(targetDir, "extensions", relName), content)
  }
}

function bundlesAt(revision) {
  const overrides = new Map()
  for (const name of GENERATED_EXTENSION_BUNDLES) {
    const content = execFileSync("git", ["show", `${revision}:packages/omo-senpi/plugin/extensions/${name}`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
    overrides.set(name, content)
  }
  return overrides
}

function runLane(name, { packagesPlugin, extraExtension, expect }) {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    // Point the settings packages entry at this lane's plugin copy instead of the repo plugin.
    writeFileSync(
      join(sandbox.agentDir, "settings.json"),
      `${JSON.stringify({ defaultProjectTrust: "ask", packages: [packagesPlugin] }, null, 2)}\n`,
    )
    writeFileSync(
      join(sandbox.cwd, "mock-script.json"),
      `${JSON.stringify({ steps: [{ type: "text", text: `${name} complete` }] }, null, 2)}\n`,
    )
    const args = ["-e", mockProviderEntry]
    if (extraExtension !== undefined) args.push("-e", extraExtension)
    args.push("-p", "--provider", "omo-mock", "--model", "mock-1", `${name} prompt`)
    const run = spawnSync(senpiBin, args, {
      cwd: sandbox.cwd,
      env: {
        ...process.env,
        OMO_CODING_AGENT_DIR: sandbox.agentDir,
        SENPI_CODING_AGENT_DIR: sandbox.agentDir,
        PI_CODING_AGENT_DIR: sandbox.agentDir,
        HOME: sandbox.homeDir,
        USERPROFILE: sandbox.homeDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome,
        XDG_DATA_HOME: sandbox.xdgDataHome,
        XDG_CACHE_HOME: sandbox.xdgCacheHome,
        PI_OFFLINE: "1",
        OMO_SENPI_QA: "1",
      },
      encoding: "utf8",
      timeout: 120_000,
    })
    const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`
    writeFileSync(join(scriptDir, `${name}.output.txt`), output)
    const observed = {
      status: run.status,
      signal: run.signal ?? null,
      standDown: output.includes(STANDDOWN),
      rangeError: output.includes(RANGE_ERROR),
      registrationFailure: output.includes(REGISTRATION_FAILURE),
      sandboxAgentDir: sandbox.agentDir,
    }
    // `status` is recorded but only asserted when the lane expects one: senpi
    // exits 0 even from the uncaughtException handler, so the crash lane pins
    // the RangeError text instead of the exit code. Lanes that claim a healthy
    // lifecycle also fail on ANY component registration error, so a partially
    // initialized extension can never pass as a live probe.
    const pass =
      (expect.status === undefined || observed.status === expect.status) &&
      (expect.registrationFailure === undefined || observed.registrationFailure === expect.registrationFailure) &&
      observed.standDown === expect.standDown &&
      observed.rangeError === expect.rangeError
    return { name, result: pass ? "PASS" : "FAIL", expect, observed }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const realOmoAgentDir = join(homedir(), ".omo", "agent")
const before = {
  senpiAgentCredentials: credentialDigest(realSenpiAgentDir),
  omoAgentCredentials: credentialDigest(realOmoAgentDir),
}

// The dependency check runs BEFORE anything is staged, and the SKIP result is
// persisted to final.json so a dependency-free rerun can never leave a stale
// PASS in the committed evidence or a populated .stage behind.
if (!existsSync(senpiBin)) {
  const skip = { result: "SKIP", reason: "senpi-binary-unavailable", senpiBin }
  writeFileSync(join(scriptDir, "final.json"), `${JSON.stringify(skip, null, 2)}\n`)
  rmSync(join(scriptDir, ".stage"), { recursive: true, force: true })
  console.log(JSON.stringify(skip))
  process.exit(1)
}

// The complete setup (bundle extraction, staging) and every lane run inside one
// guarded block: ANY unexpected error — a shallow checkout breaking the git
// extraction, a copy failure mid-stage — persists a FAIL result to final.json
// and cleans the stage before exiting, so the committed evidence always
// describes the observed run instead of leaving a stale PASS behind.
let summary
try {
  const stage = join(scriptDir, ".stage")
  rmSync(stage, { recursive: true, force: true })
  const fixedOverrides = new Map()
  const prefixOverrides = bundlesAt(process.env.PREFIX_REVISION ?? "c45968dfc~1")
  const fixedBundle = readFileSync(join(pluginRoot, "extensions", "omo.js"), "utf8")
  const prefixBundle = prefixOverrides.get("omo.js")
  if (prefixBundle.includes("standing down")) throw new Error("pre-fix bundle unexpectedly contains the fix")
  if (!fixedBundle.includes("standing down")) throw new Error("fixed bundle is missing the fix")
  const copies = {
    fixedA: join(stage, "fixed-a"),
    fixedB: join(stage, "fixed-b"),
    prefixA: join(stage, "prefix-a"),
    prefixB: join(stage, "prefix-b"),
  }
  makePluginCopy(copies.fixedA, fixedOverrides)
  makePluginCopy(copies.fixedB, fixedOverrides)
  makePluginCopy(copies.prefixA, prefixOverrides)
  makePluginCopy(copies.prefixB, prefixOverrides)

  const lanes = [
    runLane("lane1-single-load", {
      packagesPlugin: copies.fixedA,
      expect: { status: 0, standDown: false, rangeError: false, registrationFailure: false },
    }),
    runLane("lane2-dual-fixed", {
      packagesPlugin: copies.fixedA,
      extraExtension: copies.fixedB,
      expect: { status: 0, standDown: true, rangeError: false, registrationFailure: false },
    }),
    runLane("lane3-dual-prefix", {
      packagesPlugin: copies.prefixA,
      extraExtension: copies.prefixB,
      expect: { standDown: false, rangeError: true },
    }),
  ]

  rmSync(stage, { recursive: true, force: true })
  const after = {
    senpiAgentCredentials: credentialDigest(realSenpiAgentDir),
    omoAgentCredentials: credentialDigest(realOmoAgentDir),
  }
  const realSenpiUntouched = before.senpiAgentCredentials === after.senpiAgentCredentials
  const realOmoAgentUntouched = before.omoAgentCredentials === after.omoAgentCredentials
  summary = {
    // Isolation is part of the verdict: a lane that touched a real agent dir
    // fails the whole run even when every behavioral assertion passed.
    result: lanes.every((lane) => lane.result === "PASS") && realSenpiUntouched && realOmoAgentUntouched ? "PASS" : "FAIL",
    senpiBin,
    lanes,
    realSenpiUntouched,
    realOmoAgentUntouched,
  }
} catch (error) {
  rmSync(join(scriptDir, ".stage"), { recursive: true, force: true })
  summary = {
    result: "FAIL",
    reason: error instanceof Error ? error.message : String(error),
    senpiBin,
    lanes: [],
  }
}
writeFileSync(join(scriptDir, "final.json"), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.result === "PASS" ? 0 : 1)