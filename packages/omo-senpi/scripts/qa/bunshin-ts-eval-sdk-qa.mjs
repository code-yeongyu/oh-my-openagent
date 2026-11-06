#!/usr/bin/env bun
// Real AgentSession, packaged extension and real eval kernel against the fake device service: proves an eval cell
// reaches the fleet through the bunshin-ts SDK published at OMO_BUNSHIN_TS_SDK_ROOT. No model, no network, no real
// device service; the session runs in a sandboxed agent dir.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(import.meta.url)
const packageRoot = resolve(dirname(script), "../..")
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  assert.ok(args[index + 1] && !args[index + 1].startsWith("--"), `${name} requires a value`)
  return resolve(args[index + 1])
}
const pluginRoot = option("--plugin-root", join(packageRoot, "plugin"))
const deadlineMs = 120_000
const CHECKS = 5
const SDK_IMPORT = 'const sdk = await import(`${env("OMO_BUNSHIN_TS_SDK_ROOT")}/sdk.js`);'

async function runSession(sandbox) {
  const cwd = join(sandbox, "project")
  const agentDir = join(sandbox, "agent")
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@code-yeongyu/senpi")
  const settingsManager = SettingsManager.inMemory({})
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, additionalExtensionPaths: [pluginRoot] })
  let session
  const results = []
  async function check(number, name, action) {
    try {
      await action()
      results.push("PASS")
      console.log(`PASS check ${number}: ${name}`)
    } catch (error) {
      results.push("FAIL")
      console.error(`FAIL check ${number}: ${name}\n${error.stack ?? error}`)
    }
  }
  try {
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [], "extension load errors")
    ;({ session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) }))
    await session.bindExtensions({})
    console.log(`SESSION ${JSON.stringify({ pid: process.pid, cwd, agentDir, pluginRoot, stateDir: process.env.OMO_DEVICE_SERVICE_STATE_DIR })}`)
    // Each cell prints one JSON line; the check parses that line, never a substring of the cell output.
    const cellJson = async (code) => {
      console.log(`CELL ${code}`)
      const result = await session.executeTool("eval", { language: "js", code, summary: "Verify the bunshin-ts SDK through the real eval kernel" }, { signal: AbortSignal.timeout(60_000) })
      console.log(`RESULT ${JSON.stringify(result)}`)
      assert.notEqual(result.isError, true, JSON.stringify(result))
      const text = result.content.filter(part => part.type === "text").map(part => part.text).join("\n")
      const line = text.split("\n").find(entry => entry.trim().startsWith("{"))
      assert.ok(line, `No printed JSON: ${text}`)
      return JSON.parse(line)
    }
    await check(1, "kernel imports sdk.js from OMO_BUNSHIN_TS_SDK_ROOT", async () => {
      const out = await cellJson(`${SDK_IMPORT} print(JSON.stringify({ root: env("OMO_BUNSHIN_TS_SDK_ROOT"), names: ["bunshin", "connect", "createRelayTransport", "pickTransport", "BunshinSessionError", "SDK_VERSION"].filter(name => name in sdk) }))`)
      assert.equal(out.root, join(pluginRoot, "runtime", "bunshin-ts"))
      assert.deepEqual(out.names, ["bunshin", "connect", "createRelayTransport", "pickTransport", "BunshinSessionError", "SDK_VERSION"])
      assert.match(session.agent.removedToolHints.bunshin ?? "", /OMO_BUNSHIN_TS_SDK_ROOT/)
    })
    await check(2, "listMachines() lists every device although one describe is refused: that one and this device unsupported", async () => {
      const out = await cellJson(`${SDK_IMPORT} const machines = await sdk.bunshin.listMachines(); print(JSON.stringify({ machines: machines.map(m => ({ alias: m.alias, transport: m.transport, os: m.os, unsupported: m.unsupported === true, attention: m.attention ?? null })) }))`)
      assert.deepEqual(out.machines.map(({ attention, ...machine }) => machine), [
        { alias: "builder", transport: "relay", os: "linux", unsupported: false },
        { alias: "laptop", transport: "relay", os: "darwin", unsupported: false },
        { alias: "stalled", transport: "relay", os: "unknown", unsupported: true },
        { alias: "QA device", transport: "relay", os: "unknown", unsupported: true },
      ])
      assert.match(out.machines[2].attention, /^unreachable after \d+ ms: unsupported: fake-dev-stalled did not answer machine\.describe within 10 s$/)
    })
    await check(3, 'fanout over "all" yields 2 fulfilled outcomes in settle order, skips the refused device and this device, and the FanoutResult in input order', async () => {
      const out = await cellJson(`${SDK_IMPORT} const run = sdk.bunshin.fanout("all", m => m.shell("hostname")); const settled = []; for await (const o of run) settled.push({ kind: o.kind, alias: o.machine.alias, index: o.index }); const result = await run; print(JSON.stringify({ settled, fulfilled: result.fulfilled.map(f => [f.machine.alias, f.value.stdout]), rejected: result.rejected.length, skipped: (result.skipped ?? []).length }))`)
      assert.equal(out.settled.length, 4)
      const aliasesOf = kind => out.settled.filter(outcome => outcome.kind === kind).map(outcome => outcome.alias).sort()
      assert.deepEqual(aliasesOf("fulfilled"), ["builder", "laptop"], JSON.stringify(out.settled))
      assert.deepEqual(aliasesOf("skipped"), ["QA device", "stalled"], JSON.stringify(out.settled))
      assert.deepEqual(out.fulfilled, [["builder", "builder: hostname"], ["laptop", "laptop: hostname"]])
      assert.equal(out.rejected, 0)
      assert.equal(out.skipped, 2)
    })
    await check(4, "BUNSHIN_TS_TRANSPORT=relay forces relay", async () => {
      const out = await cellJson(`${SDK_IMPORT} const base = { OMO_DEVICE_SERVICE_STATE_DIR: env("OMO_DEVICE_SERVICE_STATE_DIR") }; const relay = await sdk.pickTransport({ ...base, BUNSHIN_TS_TRANSPORT: "relay" }); const hub = await sdk.pickTransport({ ...base, BUNSHIN_TS_TRANSPORT: "hub" }).then(() => "picked", e => e.code); const auto = await sdk.pickTransport(base); print(JSON.stringify({ relay: relay.kind, auto: auto.kind, hub }))`)
      assert.deepEqual(out, { relay: "relay", auto: "relay", hub: "hub_not_bundled" })
    })
    await sdkClose(cellJson)
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
      session.dispose()
      console.log("CLEANUP session_shutdown emitted; session disposed")
    }
  }
  const passed = results.filter(status => status === "PASS").length
  console.log(`WORKER ${passed}/${CHECKS - 1} session checks`)
  return results.length === CHECKS - 1 && passed === CHECKS - 1 ? 0 : 1
}

async function sdkClose(cellJson) {
  const out = await cellJson(`${SDK_IMPORT} await sdk.bunshin.close(); print(JSON.stringify({ closed: true }))`)
  assert.deepEqual(out, { closed: true })
}

async function supervise() {
  const evidenceDir = option("--evidence-dir", join(process.cwd(), ".omo/evidence/bunshin-ts-eval-sdk-qa"))
  mkdirSync(evidenceDir, { recursive: true })
  const transcript = join(evidenceDir, "bunshin-ts-eval-sdk-qa-transcript.txt")
  writeFileSync(transcript, `COMMAND ${JSON.stringify(process.argv)}\nDEADLINE_MS=${deadlineMs}\n`)
  const log = text => { appendFileSync(transcript, text); process.stdout.write(text) }
  const { isolatedEnvironment, processGroupMembers } = await import("./agent-toolkit-eval-sdk-qa-support.mjs")
  const { credentialDigest } = await import("./isolation-state.mjs")
  const { FAKE_DEVICES, startFakeDeviceService } = await import("./bunshin-ts-fake-service.ts")
  const realHomes = [join(homedir(), ".senpi", "agent"), join(homedir(), ".omo", "agent")]
  const before = realHomes.map(home => credentialDigest(home))
  const sandbox = mkdtempSync(join(tmpdir(), "omo-bunshin-ts-qa-"))
  for (const directory of ["agent", "project", "home", "tmp"]) mkdirSync(join(sandbox, directory))
  const stalled = { device: "fake-dev-stalled", label: "stalled", os: "linux", tags: [], describeRefusal: { code: "unsupported", reason: "fake-dev-stalled did not answer machine.describe within 10 s" } }
  const service = await startFakeDeviceService({ devices: [...FAKE_DEVICES, stalled] })
  log(`BOOTSTRAP sandbox=${sandbox} fakeStateDir=${service.stateDir} devices=${service.devices.length}\n`)
  let child
  let deadline
  let code = 1
  try {
    const env = { ...isolatedEnvironment(sandbox, packageRoot), OMO_DEVICE_SERVICE_STATE_DIR: service.stateDir }
    delete env.BUNSHIN_TS_TRANSPORT
    child = spawn(process.execPath, [script, "--worker", sandbox, "--plugin-root", pluginRoot], { cwd: join(sandbox, "project"), env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
    log(`BOOTSTRAP workerPid=${child.pid}\n`)
    child.stdout.on("data", chunk => log(chunk.toString()))
    child.stderr.on("data", chunk => log(chunk.toString()))
    code = await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (exitCode, signal) => { log(`WORKER_EXIT code=${exitCode} signal=${signal}\n`); resolve(exitCode ?? 1) })
      deadline = setTimeout(() => { log("FAIL QA deadline exceeded\n"); process.kill(-child.pid, "SIGKILL") }, deadlineMs)
    })
  } finally {
    clearTimeout(deadline)
    if (child?.pid) {
      const survivors = processGroupMembers(child.pid)
      log(`CLEANUP pid-tree survivors=${JSON.stringify(survivors)}\n`)
      if (survivors.length) {
        process.kill(-child.pid, "SIGKILL")
        code = 1
        log("FAIL orphan processes required SIGKILL\n")
      }
    }
    log(`FAKE_SERVICE ${JSON.stringify({ authenticated: service.authenticated(), requests: service.requests.map(request => request.type), openConnections: service.openConnections() })}\n`)
    await service.stop()
    rmSync(sandbox, { recursive: true, force: true })
    log(`CLEANUP sandbox removed=${!existsSync(sandbox)} fakeStateDir removed=${!existsSync(service.stateDir)}\n`)
  }
  const after = realHomes.map(home => credentialDigest(home))
  const changedPaths = realHomes.filter((_, index) => before[index] !== after[index])
  const realSenpiUntouched = changedPaths.length === 0
  if (realSenpiUntouched) log("PASS check 5: realSenpiUntouched\n")
  else log(`FAIL check 5: realSenpiUntouched changed=${JSON.stringify(changedPaths)}\n`)
  log(`RESULT ${JSON.stringify({ workerExit: code, realSenpiUntouched, changedPaths, isolatedAgentDir: join(sandbox, "agent"), checkedHomes: realHomes, isolationScope: "credential-file digests of the real agent homes" })}\n`)
  return code === 0 && realSenpiUntouched ? 0 : 1
}

try {
  process.exitCode = args.includes("--worker") ? await runSession(option("--worker")) : await supervise()
} catch (error) {
  console.error(`FAIL harness: ${error.stack ?? error}`)
  process.exitCode = 1
}
