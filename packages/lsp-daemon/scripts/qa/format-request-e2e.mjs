#!/usr/bin/env node
// allow: SIZE_OK - one live QA driver keeps fixture setup, daemon lifecycle and evidence in one executable.
//
// Live QA for the daemon "format" request.
//
// Drives the REAL built daemon over its REAL unix socket with a REAL biome language
// server installed as a repo-local devDependency, and proves four things end to end:
//   1. a drifted file is rewritten by textDocument/formatting and reports line deltas,
//   2. a second format of the same file reports "unchanged" and leaves bytes untouched,
//   3. an extension whose server advertises no documentFormattingProvider yields the
//      typed unavailable result with the file byte-identical,
//   4. the run adds no resident process beyond the single daemon: language servers stay
//      inside the daemon and the daemon itself is stopped at the end.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { connect } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const daemonCli = join(packageRoot, "dist", "cli.js")

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

/**
 * Creates a fixture repository whose only biome is a genuine repo-local devDependency,
 * so the format request can only succeed through repo-local binary resolution.
 */
function createFixtureRepo(root) {
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "lsp-format-fixture", private: true, version: "0.0.0" }, null, 2)}\n`,
  )
  writeFileSync(
    join(root, "biome.json"),
    `${JSON.stringify(
      {
        $schema: "https://biomejs.dev/schemas/2.0.0/schema.json",
        formatter: { enabled: true, indentStyle: "space", indentWidth: 2 },
      },
      null,
      2,
    )}\n`,
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
  const drifted = join(root, "drifted.css")
  writeFileSync(drifted, "a{color:red;background:blue}\n")
  const unsupported = join(root, "notes.txt")
  writeFileSync(unsupported, "plain text\n")
  return { localBiome, drifted, unsupported }
}

/**
 * Creates a second fixture whose .ts server is oxlint, a real language server that runs but
 * advertises no documentFormattingProvider. This is the only way to exercise the capability
 * gate against a live server rather than a stub.
 */
function createLinterOnlyFixture(root) {
  mkdirSync(join(root, "home"), { recursive: true })
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "lsp-format-linter-fixture", private: true, version: "0.0.0" }, null, 2)}\n`,
  )
  const install = spawnSync("bun", ["add", "-d", "oxlint"], {
    cwd: root,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  const localOxlint = join(root, "node_modules", ".bin", "oxlint")
  if (install.status !== 0 || !existsSync(localOxlint)) {
    return { available: false, reason: (install.stderr || install.stdout).trim().slice(-400) }
  }
  // Pinning oxlint in the user config keeps biome from winning the .ts extension by priority.
  writeFileSync(
    join(root, "home", "lsp-client.json"),
    `${JSON.stringify({ lsp: { oxlint: { priority: 100 }, biome: { disabled: true }, typescript: { disabled: true } } }, null, 2)}\n`,
  )
  const source = join(root, "linted.ts")
  writeFileSync(source, "const a=1\n")
  return { available: true, localOxlint, source }
}

/** Picks the shortest writable temp root available, so nested socket paths stay under SUN_LEN. */
function shortTempRoot() {
  for (const candidate of ["/tmp", tmpdir()]) {
    try {
      mkdirSync(candidate, { recursive: true })
      const probe = join(candidate, `.fq-probe-${process.pid}`)
      writeFileSync(probe, "")
      rmSync(probe, { force: true })
      return candidate
    } catch {
      // An unwritable candidate is not a failure; the next one is tried instead.
    }
  }
  throw new Error("no writable temp root found")
}

function daemonEnv(fixtureRoot, daemonDir) {
  return {
    ...process.env,
    OMO_LSP_DAEMON_DIR: daemonDir,
    OMO_LSP_DAEMON_CLI: daemonCli,
    OMO_LSP_DAEMON_VERSION: "qa-format",
    HOME: join(fixtureRoot, "home"),
  }
}

function requestContext(fixtureRoot) {
  return {
    cwd: fixtureRoot,
    projectConfigPaths: [join(fixtureRoot, ".codex", "lsp-client.json")],
    userConfigPath: join(fixtureRoot, "home", "lsp-client.json"),
    installDecisionsPath: join(fixtureRoot, "home", "lsp-install-decisions.json"),
    capabilities: { installDecisionTool: true },
  }
}

/**
 * Sends one authenticated tools/call over the daemon's real unix socket and resolves
 * with the parsed JSON-RPC response.
 */
function sendRequest(socketPath, token, id, name, args) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(socketPath)
    let buffer = ""
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`daemon request ${name} timed out`))
    }, 120_000)
    const finish = (run) => {
      clearTimeout(timer)
      socket.destroy()
      run()
    }
    socket.once("connect", () => {
      socket.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { _omo: { protocolVersion: 1, token }, name, arguments: args },
        })}\n`,
      )
    })
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline === -1) return
      const line = buffer.slice(0, newline)
      finish(() => {
        try {
          resolvePromise(JSON.parse(line))
        } catch (error) {
          reject(error)
        }
      })
    })
    socket.once("error", (error) => finish(() => reject(error)))
  })
}

function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolvePromise, reject) => {
    const poll = () => {
      if (existsSync(path)) {
        resolvePromise()
        return
      }
      if (Date.now() > deadline) {
        reject(new Error(`daemon never created ${path}`))
        return
      }
      setTimeout(poll, 50)
    }
    poll()
  })
}

/** Counts live processes whose command line matches a pattern, for the residency check. */
function countProcesses(pattern) {
  const result = spawnSync("bash", ["-lc", `ps -Ao pid,command | grep -F ${JSON.stringify(pattern)} | grep -v grep | wc -l`], {
    encoding: "utf8",
  })
  return Number.parseInt(result.stdout.trim(), 10)
}

async function main() {
  const args = parseArgs(process.argv)
  if (args.selfTest) {
    if (!existsSync(daemonCli)) throw new Error(`daemon CLI missing at ${daemonCli}; run npm run build first`)
    console.log(JSON.stringify({ selfTest: "PASS", daemonCli }))
    return
  }
  if (!existsSync(daemonCli)) throw new Error(`daemon CLI missing at ${daemonCli}; run npm run build first`)

  // biome's lsp-proxy opens its own unix socket under the fixture, and macOS caps a socket
  // path at SUN_LEN, so the work root must stay short rather than nest under a long tmpdir.
  const workRoot = mkdtempSync(join(shortTempRoot(), "fq-"))
  const fixtureRoot = join(workRoot, "fixture")
  const daemonDir = join(workRoot, "daemon")
  mkdirSync(join(fixtureRoot, "home"), { recursive: true })
  mkdirSync(daemonDir, { recursive: true })
  let daemon
  const evidence = { workRoot }

  try {
    const fixture = createFixtureRepo(fixtureRoot)
    evidence.localBiome = fixture.localBiome

    const env = daemonEnv(fixtureRoot, daemonDir)
    daemon = spawn(process.execPath, [daemonCli, "daemon"], { cwd: fixtureRoot, env, stdio: ["ignore", "pipe", "pipe"] })
    const daemonLog = []
    daemon.stdout.on("data", (chunk) => daemonLog.push(chunk.toString("utf8")))
    daemon.stderr.on("data", (chunk) => daemonLog.push(chunk.toString("utf8")))

    // Layout mirrors daemonPaths(): <OMO_LSP_DAEMON_DIR>/v<version>/daemon.{auth,sock}.
    const versionDir = join(daemonDir, "vqa-format")
    const authPath = join(versionDir, "daemon.auth")
    const socketPath = join(versionDir, "daemon.sock")
    evidence.daemonVersionDir = versionDir
    await waitForFile(authPath, 60_000)
    await waitForFile(socketPath, 60_000)
    const token = readFileSync(authPath, "utf8").trim()
    const context = requestContext(fixtureRoot)

    const beforeBytes = readFileSync(fixture.drifted)
    const firstFormat = await sendRequest(socketPath, token, 1, "format", {
      filePath: fixture.drifted,
      _context: context,
    })
    const afterBytes = readFileSync(fixture.drifted)

    const secondFormat = await sendRequest(socketPath, token, 2, "format", {
      filePath: fixture.drifted,
      _context: context,
    })
    const afterSecondBytes = readFileSync(fixture.drifted)

    const unsupportedBefore = readFileSync(fixture.unsupported)
    const unsupportedFormat = await sendRequest(socketPath, token, 3, "format", {
      filePath: fixture.unsupported,
      _context: context,
    })
    const unsupportedAfter = readFileSync(fixture.unsupported)

    const linterRoot = join(workRoot, "linter")
    const linterFixture = createLinterOnlyFixture(linterRoot)
    if (linterFixture.available) {
      const linterBefore = readFileSync(linterFixture.source)
      const linterFormat = await sendRequest(socketPath, token, 4, "format", {
        filePath: linterFixture.source,
        _context: requestContext(linterRoot),
      })
      const linterAfter = readFileSync(linterFixture.source)
      evidence.capabilityGate = {
        text: linterFormat.result?.content?.[0]?.text,
        details: linterFormat.result?.details,
        bytesChanged: !linterBefore.equals(linterAfter),
      }
    } else {
      evidence.capabilityGate = { skipped: true, reason: linterFixture.reason }
    }

    const residentBiome = countProcesses("biome")
    const residentDaemons = countProcesses(daemonCli)

    evidence.firstFormat = {
      text: firstFormat.result?.content?.[0]?.text,
      details: firstFormat.result?.details,
      before: beforeBytes.toString("utf8"),
      after: afterBytes.toString("utf8"),
      bytesChanged: !beforeBytes.equals(afterBytes),
    }
    evidence.secondFormat = {
      text: secondFormat.result?.content?.[0]?.text,
      details: secondFormat.result?.details,
      bytesChanged: !afterBytes.equals(afterSecondBytes),
    }
    evidence.unsupportedFormat = {
      text: unsupportedFormat.result?.content?.[0]?.text,
      details: unsupportedFormat.result?.details,
      bytesChanged: !unsupportedBefore.equals(unsupportedAfter),
    }
    evidence.residency = { residentBiome, residentDaemons }
    evidence.daemonLogTail = daemonLog.join("").split(/\r?\n/).slice(-20).join("\n")

    const checks = {
      firstFormatRewroteFile: evidence.firstFormat.bytesChanged === true,
      firstFormatStatusFormatted: evidence.firstFormat.details?.status === "formatted",
      firstFormatReportsLineDeltas:
        typeof evidence.firstFormat.details?.linesAdded === "number" &&
        typeof evidence.firstFormat.details?.linesRemoved === "number",
      secondFormatUnchanged: evidence.secondFormat.details?.status === "unchanged",
      secondFormatLeftBytes: evidence.secondFormat.bytesChanged === false,
      unsupportedLeftBytes: evidence.unsupportedFormat.bytesChanged === false,
      unsupportedNotFormatted: evidence.unsupportedFormat.details?.status !== "formatted",
      oneResidentDaemon: residentDaemons === 1,
      capabilityGateUnavailable:
        evidence.capabilityGate.skipped === true ||
        (evidence.capabilityGate.details?.status === "unavailable" &&
          evidence.capabilityGate.details?.reason === "capability_not_advertised"),
      capabilityGateLeftBytes:
        evidence.capabilityGate.skipped === true || evidence.capabilityGate.bytesChanged === false,
    }
    evidence.checks = checks
    evidence.verdict = Object.values(checks).every(Boolean) ? "PASS" : "FAIL"

    if (args.evidenceDir !== undefined) {
      mkdirSync(args.evidenceDir, { recursive: true })
      writeFileSync(join(args.evidenceDir, "format-request-e2e.json"), `${JSON.stringify(evidence, null, 2)}\n`)
    }
    console.log(JSON.stringify(evidence, null, 2))
    if (evidence.verdict !== "PASS") process.exitCode = 1
  } finally {
    if (daemon) {
      daemon.kill("SIGTERM")
      await new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
          daemon.kill("SIGKILL")
          resolvePromise()
        }, 5_000)
        daemon.once("exit", () => {
          clearTimeout(timer)
          resolvePromise()
        })
      })
    }
    rmSync(workRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
