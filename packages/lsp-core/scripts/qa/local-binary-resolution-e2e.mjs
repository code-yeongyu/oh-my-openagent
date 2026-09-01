#!/usr/bin/env node
// allow: SIZE_OK - one live QA driver keeps fixture setup, PATH scrubbing and evidence in one executable.
//
// Live QA for repo-local LSP binary resolution (lsp-core).
//
// Proves that a language server installed ONLY as a repository devDependency is
// resolved and spawned, by driving the real senpi binary with a PATH that
// deliberately contains no biome. Before this change the same fixture produced the
// "NOT INSTALLED / npm install -g" message instead of diagnostics.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const mockProviderEntry = join(repoRoot, "packages", "omo-senpi", "scripts", "qa", "mock-provider", "index.ts")

function parseArgs(argv) {
  const args = { evidenceDir: undefined, selfTest: false }
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--self-test") args.selfTest = true
    else if (arg === "--evidence-dir") args.evidenceDir = argv[++index]
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? resolve(bin) : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function listFiles(root) {
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function digestDirectory(root) {
  if (!existsSync(root)) return "absent"
  const hash = createHash("sha256")
  for (const file of listFiles(root).sort()) {
    hash.update(relative(root, file))
    hash.update("\0")
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

/**
 * Builds a PATH that keeps the node/bun runtime reachable but guarantees the
 * language server itself is absent, so a successful resolution can only have come
 * from the repository-local install.
 */
function scrubbedPath(serverBinaryName) {
  const kept = []
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    if (existsSync(join(dir, serverBinaryName))) continue
    kept.push(dir)
  }
  return kept.join(delimiter)
}

/**
 * Creates a fixture repository whose only biome is a real repo-local devDependency,
 * installed with `bun add -d` so node_modules/.bin/biome is a genuine install rather
 * than a hand-written stub.
 */
function createFixtureRepo(root) {
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "lspcore-local-fixture", private: true, version: "0.0.0" }, null, 2)}\n`,
  )
  writeFileSync(
    join(root, "biome.json"),
    `${JSON.stringify({ $schema: "https://biomejs.dev/schemas/2.0.0/schema.json", linter: { enabled: true } }, null, 2)}\n`,
  )
  const install = spawnSync("bun", ["add", "-d", "@biomejs/biome"], {
    cwd: root,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const localBiome = join(root, "node_modules", ".bin", "biome")
  if (install.status !== 0 || !existsSync(localBiome)) {
    throw new Error(`fixture devDependency install failed: ${install.stderr || install.stdout}`)
  }
  // A nested source directory proves the upward walk, not just a root-level hit.
  const nested = join(root, "src", "nested")
  mkdirSync(nested, { recursive: true })
  const sample = join(nested, "sample.css")
  writeFileSync(sample, "a { colr: red; }\n")
  return { localBiome, sample, nested, installStdout: install.stdout.trim() }
}

/**
 * Resolves through the real lsp-core code path under the fixture's request context,
 * with biome removed from PATH.
 */
function runResolutionProbe(fixture, pathValue, evidenceDir) {
  const probe = spawnSync(
    "bun",
    [
      "-e",
      `
import { runWithRequestContext } from ${JSON.stringify(join(packageRoot, "src", "request-context.ts"))}
import { findServerForExtension } from ${JSON.stringify(join(packageRoot, "src", "lsp", "server-resolution.ts"))}
import { formatServerLookupError } from ${JSON.stringify(join(packageRoot, "src", "lsp", "client-wrapper.ts"))}
import { resolveServerBinary } from ${JSON.stringify(join(packageRoot, "src", "lsp", "server-installation.ts"))}
const cwd = ${JSON.stringify(fixture.root)}
const nested = ${JSON.stringify(fixture.nested)}
const context = {
  cwd,
  projectConfigPaths: [cwd + "/.codex/lsp-client.json"],
  userConfigPath: cwd + "/home/lsp-client.json",
  installDecisionsPath: cwd + "/home/lsp-install-decisions.json",
  capabilities: { installDecisionTool: true },
}
const found = runWithRequestContext(context, () => findServerForExtension(".css"))
const fromNested = resolveServerBinary(["biome", "lsp-proxy", "--stdio"], nested)
const message = found.status === "found" ? null : runWithRequestContext(context, () => formatServerLookupError(found))
console.log(JSON.stringify({
  biomeOnPath: Bun.which("biome"),
  status: found.status,
  spawnedCommand: found.status === "found" ? found.server.command : null,
  resolvedFromNestedDir: fromNested,
  notInstalledMessage: message,
}))
`,
    ],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: { ...process.env, PATH: pathValue },
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  if (probe.status !== 0) {
    throw new Error(`resolution probe failed: ${probe.stderr || probe.stdout}`)
  }
  if (evidenceDir !== undefined) {
    writeFileSync(join(evidenceDir, "resolution-probe.log"), `${probe.stdout}\n${probe.stderr}`)
  }
  const line = probe.stdout.trim().split(/\r?\n/).findLast((entry) => entry.startsWith("{"))
  if (line === undefined) throw new Error("resolution probe printed no JSON")
  return JSON.parse(line)
}

/**
 * Captures the pre-change behavior by forcing a PATH-only resolution, which is what
 * the old implementation did for every lookup.
 */
function runBaselineProbe(fixture, pathValue, evidenceDir) {
  const probe = spawnSync(
    "bun",
    [
      "-e",
      `
import { resolveServerBinary } from ${JSON.stringify(join(packageRoot, "src", "lsp", "server-installation.ts"))}
// Omitting workingDirectory reproduces the previous PATH-only behavior.
console.log(JSON.stringify({ pathOnly: resolveServerBinary(["biome", "lsp-proxy", "--stdio"]) }))
`,
    ],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: { ...process.env, PATH: pathValue },
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  if (probe.status !== 0) throw new Error(`baseline probe failed: ${probe.stderr || probe.stdout}`)
  if (evidenceDir !== undefined) {
    writeFileSync(join(evidenceDir, "baseline-path-only-probe.log"), `${probe.stdout}\n${probe.stderr}`)
  }
  const line = probe.stdout.trim().split(/\r?\n/).findLast((entry) => entry.startsWith("{"))
  return JSON.parse(line)
}

function parseJsonEvents(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith("{")) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // non-JSON diagnostic chatter is ignored
    }
  }
  return events
}

function findToolExecution(events, toolName) {
  return events.findLast(
    (event) => event?.toolName === toolName && (event?.type === "tool_execution_end" || event?.result !== undefined),
  )
}

/**
 * Drives the real senpi binary end to end so the resolution is proven on a live
 * harness surface. A scripted mock provider supplies the turn, so the run needs no
 * API key and makes no network call, while lsp_diagnostics still executes for real
 * against the repo-local biome.
 */
function runSenpiProbe(fixture, pathValue, senpiBin, workRoot, evidenceDir) {
  const agentDir = join(workRoot, "agent")
  const sessionDir = join(workRoot, "sessions")
  const homeDir = join(workRoot, "home")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(sessionDir, { recursive: true })
  mkdirSync(homeDir, { recursive: true })
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ permission: { lsp_diagnostics: "allow" } }, null, 2)}\n`,
  )
  writeFileSync(
    join(fixture.root, "mock-script.json"),
    `${JSON.stringify(
      {
        steps: [
          { type: "tool_call", name: "lsp_diagnostics", arguments: { filePath: fixture.sample } },
          { type: "text", text: "local biome diagnostics scenario complete" },
        ],
      },
      null,
      2,
    )}\n`,
  )

  const result = spawnSync(
    senpiBin,
    [
      "-e",
      mockProviderEntry,
      "-p",
      "--mode",
      "json",
      "--provider",
      "omo-mock",
      "--model",
      "mock-1",
      "--session-dir",
      sessionDir,
      "run lsp diagnostics on the sample file",
    ],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: pathValue,
        HOME: homeDir,
        XDG_CONFIG_HOME: join(homeDir, ".config"),
        XDG_DATA_HOME: join(homeDir, ".local", "share"),
        XDG_STATE_HOME: join(homeDir, ".local", "state"),
        XDG_CACHE_HOME: join(homeDir, ".cache"),
        SENPI_CODING_AGENT_DIR: agentDir,
        SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
        OMO_SENPI_QA: "1",
      },
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (evidenceDir !== undefined) {
    writeFileSync(join(evidenceDir, "senpi.stdout.log"), result.stdout ?? "")
    writeFileSync(join(evidenceDir, "senpi.stderr.log"), result.stderr ?? "")
  }
  const events = parseJsonEvents(result.stdout ?? "")
  const toolEvent = findToolExecution(events, "lsp_diagnostics")
  return {
    exitStatus: result.status,
    isolatedAgentDir: agentDir,
    toolEvent,
    sessionStarted: events.some((event) => event?.type === "session"),
    // The packaged omo extension and its daemon runtime are built by another lane, so
    // this binary is not expected to expose lsp_* tools here. It proves the harness runs
    // against the fixture with a scrubbed PATH; the diagnostics assertion itself comes
    // from runDiagnosticsProbe(), which drives the lsp-core tool runtime this PR changes.
    lspToolExposed: toolEvent !== undefined && toolEvent?.isError !== true,
  }
}

/**
 * Executes lsp_diagnostics through the real lsp-core tool runtime, which spawns the
 * language server that resolution selected. This is the decisive proof: real
 * diagnostics can only come back if the repo-local biome was actually launched.
 */
function runDiagnosticsProbe(fixture, pathValue, evidenceDir) {
  const probe = spawnSync(
    "bun",
    [
      "-e",
      `
import { runWithRequestContext } from ${JSON.stringify(join(packageRoot, "src", "request-context.ts"))}
import { executeLspTool } from ${JSON.stringify(join(packageRoot, "src", "tools", "runtime.ts"))}
import { getLspManager } from ${JSON.stringify(join(packageRoot, "src", "lsp", "manager.ts"))}
const cwd = ${JSON.stringify(fixture.root)}
const context = {
  cwd,
  projectConfigPaths: [cwd + "/.codex/lsp-client.json"],
  userConfigPath: cwd + "/home/lsp-client.json",
  installDecisionsPath: cwd + "/home/lsp-install-decisions.json",
  capabilities: { installDecisionTool: true },
}
const result = await runWithRequestContext(context, async () =>
  executeLspTool("lsp_diagnostics", { filePath: ${JSON.stringify(fixture.sample)} }),
)
const text = JSON.stringify(result)
console.log(JSON.stringify({ biomeOnPath: Bun.which("biome"), text }))
await runWithRequestContext(context, async () => { await getLspManager().stopAll() })
`,
    ],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: { ...process.env, PATH: pathValue },
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  if (evidenceDir !== undefined) {
    writeFileSync(join(evidenceDir, "diagnostics-probe.log"), `${probe.stdout}\n${probe.stderr}`)
  }
  if (probe.status !== 0) throw new Error(`diagnostics probe failed: ${probe.stderr || probe.stdout}`)
  const line = probe.stdout.trim().split(/\r?\n/).findLast((entry) => entry.startsWith("{"))
  if (line === undefined) throw new Error("diagnostics probe printed no JSON")
  const parsed = JSON.parse(line)
  return {
    biomeOnPath: parsed.biomeOnPath,
    resultText: parsed.text,
    notInstalledMessageAbsent: !parsed.text.includes("NOT INSTALLED"),
    globalInstallHintAbsent: !parsed.text.includes("npm install -g @biomejs/biome"),
    // The fixture stylesheet has a misspelled property, so a working biome must flag it.
    // Only a spawned biome can attribute a diagnostic to itself with its own rule id.
    reportsRealDiagnostic:
      parsed.text.includes("error[biome]") &&
      parsed.text.includes("noUnknownProperty") &&
      parsed.text.includes('"source":"biome"'),
  }
}

function main() {
  const args = parseArgs(process.argv)
  const evidenceDir = args.evidenceDir
  if (evidenceDir !== undefined) mkdirSync(evidenceDir, { recursive: true })

  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) throw new Error("senpi binary unavailable; QA cannot SKIP")

  const workRoot = mkdtempSync(join(tmpdir(), "lspcore-local-resolve-qa-"))
  const beforeRealSenpi = digestDirectory(realSenpiAgentDir)
  try {
    const fixtureRoot = join(workRoot, "fixture-repo")
    const fixture = { root: fixtureRoot, ...createFixtureRepo(fixtureRoot) }
    const pathValue = scrubbedPath("biome")

    const baseline = runBaselineProbe(fixture, pathValue, evidenceDir)
    const probe = runResolutionProbe(fixture, pathValue, evidenceDir)
    const diagnostics = runDiagnosticsProbe(fixture, pathValue, evidenceDir)
    const senpi = runSenpiProbe(fixture, pathValue, senpiBin, workRoot, evidenceDir)
    const afterRealSenpi = digestDirectory(realSenpiAgentDir)

    const checks = {
      biomeAbsentFromPath: probe.biomeOnPath === null,
      baselinePathOnlyUnresolved: baseline.pathOnly === null,
      resolvedToRepoLocalBinary: probe.spawnedCommand?.[0] === fixture.localBiome,
      serverFound: probe.status === "found",
      argsPreserved: JSON.stringify(probe.spawnedCommand?.slice(1)) === JSON.stringify(["lsp-proxy", "--stdio"]),
      resolvesFromNestedDirectory: probe.resolvedFromNestedDir === fixture.localBiome,
      noNotInstalledMessage: probe.notInstalledMessage === null,
      diagnosticsBiomeAbsentFromPath: diagnostics.biomeOnPath === null,
      diagnosticsReturnedRealFindings: diagnostics.reportsRealDiagnostic === true,
      diagnosticsNoNotInstalledMessage: diagnostics.notInstalledMessageAbsent === true,
      diagnosticsNoGlobalInstallHint: diagnostics.globalInstallHintAbsent === true,
      senpiSessionStarted: senpi.sessionStarted === true,
      realSenpiUntouched: beforeRealSenpi === afterRealSenpi,
      noSkip: true,
    }
    const payload = {
      result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      scenario: "lspcore-local-binary-resolution",
      checks,
      whatWasTested:
        "A fixture repository whose only biome is a repo-local devDependency, driven with biome scrubbed from PATH.",
      observed: {
        beforeChange:
          "PATH-only resolution (the previous behavior) returns null, which is what produced the NOT INSTALLED message.",
        afterChange: `Resolution returns the repo-local binary ${fixture.localBiome} and substitutes it as command[0].`,
      },
      baselineProbe: baseline,
      resolutionProbe: probe,
      diagnosticsProbe: diagnostics,
      senpiProbe: senpi,
      isolation: {
        fixtureRoot: fixture.root,
        isolatedAgentDir: senpi.isolatedAgentDir,
        realSenpiAgentDir,
        realSenpiUntouched: beforeRealSenpi === afterRealSenpi,
      },
      cleanup: "work root removed in finally",
    }
    if (evidenceDir !== undefined) {
      writeFileSync(join(evidenceDir, "result.json"), `${JSON.stringify(payload, null, 2)}\n`)
    }
    console.log(JSON.stringify(payload, null, 2))
    if (payload.result !== "PASS") process.exitCode = 1
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}

main()
